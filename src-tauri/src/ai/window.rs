use once_cell::sync::Lazy;
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "ai-chat";

static PENDING_FEED: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

/// Take and clear any pending feed text written by `open_or_focus_ai_chat`.
pub fn take_pending_feed() -> Option<String> {
    PENDING_FEED.lock().take()
}

fn emit_feed_later(app: &AppHandle, feed_text: Option<String>) {
    let Some(text) = feed_text else {
        return;
    };
    let app2 = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        if let Some(w) = app2.get_webview_window(LABEL) {
            let _ = w.emit("ai://feed", text);
        }
    });
}

/// Show the AI chat window centered on screen (reuse if already open).
///
/// Caller MUST invoke this from an **async** Tauri command on Windows when
/// creating a new window, otherwise WebView2 deadlocks (white screen).
/// See https://github.com/tauri-apps/tauri/issues/13963
pub fn open_or_focus_ai_chat(app: &AppHandle, feed_text: Option<String>) -> Result<(), String> {
    if let Some(ref text) = feed_text {
        *PENDING_FEED.lock() = Some(text.clone());
    }

    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.center();
        let _ = win.show();
        let _ = win.set_focus();
        emit_feed_later(app, feed_text);
        return Ok(());
    }

    // Dedicated `ai.html` entry (Vite MPA). In dev Tauri maps App URLs to the Vite server.
    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("ai.html".into()))
        .title("FPM — AI Chat")
        .inner_size(1100.0, 760.0)
        .min_inner_size(800.0, 560.0)
        .resizable(true)
        .closable(true)
        .build()
        .map_err(|e| e.to_string())?;

    let _ = win.center();
    let _ = win.show();
    let _ = win.set_focus();
    emit_feed_later(app, feed_text);

    Ok(())
}
