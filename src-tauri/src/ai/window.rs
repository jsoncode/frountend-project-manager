use once_cell::sync::Lazy;
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "ai-chat";

static PENDING_FEED: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

/// Take and clear any pending feed text written by `open_or_focus_ai_chat`.
pub fn take_pending_feed() -> Option<String> {
    PENDING_FEED.lock().take()
}

/// Open the dedicated AI chat window, or show/focus it if it already exists.
/// When `feed_text` is provided it is stored in `PENDING_FEED` (replace) and also
/// emitted as `ai://feed` (immediate for existing windows; delayed emit as backup for new ones).
pub fn open_or_focus_ai_chat(app: &AppHandle, feed_text: Option<String>) -> Result<(), String> {
    if let Some(ref text) = feed_text {
        *PENDING_FEED.lock() = Some(text.clone());
    }

    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.show();
        let _ = w.set_focus();
        if let Some(text) = feed_text {
            let _ = w.emit("ai://feed", text);
        }
        return Ok(());
    }

    // PathBuf-based App URLs do not reliably preserve URL fragments; set hash via
    // initialization_script so `#/ai` is present before the frontend module boots.
    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("FPM — AI Chat")
        .inner_size(1100.0, 760.0)
        .min_inner_size(800.0, 560.0)
        .initialization_script(
            r#"(function () {
  if (!String(location.hash || '').startsWith('#/ai')) {
    location.hash = '#/ai';
  }
})();"#,
        )
        .build()
        .map_err(|e| e.to_string())?;

    if let Some(text) = feed_text {
        let app2 = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(400));
            if let Some(w) = app2.get_webview_window(LABEL) {
                let _ = w.emit("ai://feed", text);
            }
        });
    }

    let _ = win;
    Ok(())
}
