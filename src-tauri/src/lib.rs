//! Ready Room desktop shell. The app itself is the web build in `dist/`; this
//! side only stores the STCC card database (fetched on first launch by
//! src/data/stccFetch.ts, never shipped with the app) under the app-data
//! folder and serves it back to the webview over the `stcc` URI scheme.
//!
//! Layout below `<app data>/stcc/` mirrors the logical paths the fetcher uses:
//! `vendor/…` (card JSON, icon index, manifest) and `public/…` (scans, icons).

use std::path::{Component, Path, PathBuf};

use tauri::http::{header, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime};
use tokio::io::AsyncWriteExt;

/// The only host the fetcher may download from: the STCC database's repo.
const STCC_ORIGIN: &str = "https://raw.githubusercontent.com/periodic-agent/stcc-strategy/";

fn stcc_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("stcc"))
        .map_err(|e| e.to_string())
}

/// `vendor/…` or `public/…`, relative, with no `..` or other escapes.
fn safe_rel(rel: &str) -> Result<&Path, String> {
    let path = Path::new(rel);
    let mut parts = path.components();
    let top_ok =
        matches!(parts.next(), Some(Component::Normal(top)) if top == "vendor" || top == "public");
    let rest: Vec<_> = parts.collect();
    if !top_ok || rest.is_empty() || !rest.iter().all(|c| matches!(c, Component::Normal(_))) {
        return Err(format!("bad path: {rel}"));
    }
    Ok(path)
}

fn resolve<R: Runtime>(app: &AppHandle<R>, rel: &str) -> Result<PathBuf, String> {
    Ok(stcc_root(app)?.join(safe_rel(rel)?))
}

fn check_url(url: &str) -> Result<(), String> {
    if url.starts_with(STCC_ORIGIN) && !url.contains("..") {
        Ok(())
    } else {
        Err(format!("refusing to fetch {url}"))
    }
}

async fn get(url: &str) -> Result<reqwest::Response, String> {
    check_url(url)?;
    let res = reqwest::get(url).await.map_err(|e| e.to_string())?;
    let status = res.status();
    if !status.is_success() {
        // the fetcher retries on a 5xx in the message
        return Err(format!(
            "{} {}: {url}",
            status.as_u16(),
            status.canonical_reason().unwrap_or("")
        ));
    }
    Ok(res)
}

fn part_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".part");
    PathBuf::from(name)
}

/// Write via a `.part` file and rename, so an interrupted download never leaves
/// a truncated file that the next run would skip.
async fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir)
            .await
            .map_err(|e| e.to_string())?;
    }
    let part = part_path(path);
    tokio::fs::write(&part, bytes)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::rename(&part, path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn stcc_fetch_text(url: String) -> Result<String, String> {
    get(&url).await?.text().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn stcc_download<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    rel: String,
) -> Result<(), String> {
    let path = resolve(&app, &rel)?;
    let mut res = get(&url).await?;
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir)
            .await
            .map_err(|e| e.to_string())?;
    }
    let part = part_path(&path);
    let mut file = tokio::fs::File::create(&part)
        .await
        .map_err(|e| e.to_string())?;
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    tokio::fs::rename(&part, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn stcc_write_text<R: Runtime>(
    app: AppHandle<R>,
    rel: String,
    text: String,
) -> Result<(), String> {
    write_atomic(&resolve(&app, &rel)?, text.as_bytes()).await
}

/// Raw IPC body; the target path travels in the `rel` header.
#[tauri::command]
async fn stcc_write_bytes<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let rel = request
        .headers()
        .get("rel")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing rel header")?
        .to_owned();
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected a raw body".into());
    };
    write_atomic(&resolve(&app, &rel)?, bytes).await
}

#[tauri::command]
async fn stcc_exists<R: Runtime>(app: AppHandle<R>, rel: String) -> Result<bool, String> {
    Ok(tokio::fs::try_exists(resolve(&app, &rel)?)
        .await
        .unwrap_or(false))
}

#[tauri::command]
async fn stcc_read_text<R: Runtime>(
    app: AppHandle<R>,
    rel: String,
) -> Result<Option<String>, String> {
    Ok(tokio::fs::read_to_string(resolve(&app, &rel)?).await.ok())
}

#[tauri::command]
fn stcc_folder<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    Ok(stcc_root(&app)?.display().to_string())
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("json") => "application/json",
        _ => "application/octet-stream",
    }
}

/// `stcc://localhost/public/img/box1/x.jpg` (macOS/Linux) or
/// `http://stcc.localhost/public/…` (Windows) → `<app data>/stcc/public/…`.
async fn serve<R: Runtime>(app: &AppHandle<R>, uri_path: &str) -> Response<Vec<u8>> {
    let not_found = || {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(Vec::new())
            .unwrap()
    };
    let rel = percent_decode(uri_path.trim_start_matches('/'));
    let Ok(path) = resolve(app, &rel) else {
        return not_found();
    };
    match tokio::fs::read(&path).await {
        Ok(bytes) => Response::builder()
            .header(header::CONTENT_TYPE, content_type(&path))
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::CACHE_CONTROL, "no-cache")
            .body(bytes)
            .unwrap(),
        Err(_) => not_found(),
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("stcc", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_owned();
            tauri::async_runtime::spawn(async move {
                responder.respond(serve(&app, &path).await);
            });
        })
        .invoke_handler(tauri::generate_handler![
            stcc_fetch_text,
            stcc_download,
            stcc_write_text,
            stcc_write_bytes,
            stcc_exists,
            stcc_read_text,
            stcc_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ready Room");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rel_paths_stay_inside_the_stcc_folder() {
        assert!(safe_rel("vendor/box1.json").is_ok());
        assert!(safe_rel("public/img/box1/a.jpg").is_ok());
        assert!(safe_rel("vendor").is_err());
        assert!(safe_rel("other/x").is_err());
        assert!(safe_rel("public/../../etc/passwd").is_err());
        assert!(safe_rel("/vendor/x").is_err());
    }

    #[test]
    fn only_the_stcc_repo_is_fetched() {
        assert!(check_url(
            "https://raw.githubusercontent.com/periodic-agent/stcc-strategy/abc/box1.json"
        )
        .is_ok());
        assert!(check_url("https://example.com/x").is_err());
        assert!(check_url(
            "https://raw.githubusercontent.com/periodic-agent/stcc-strategy/../evil/x"
        )
        .is_err());
    }

    #[test]
    fn decodes_percent_escapes() {
        assert_eq!(
            percent_decode("public/img/box1/a%20b.jpg"),
            "public/img/box1/a b.jpg"
        );
        assert_eq!(percent_decode("100%"), "100%");
    }
}
