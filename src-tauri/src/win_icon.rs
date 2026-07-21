//! Windows taskbar/titlebar icon helpers.
//!
//! Tauri only applies `ICON_SMALL` via `set_icon`. The taskbar uses `ICON_BIG`.
//! When `ICON_BIG` is missing, Windows falls back to the EXE resource and can
//! show a corrupted solid-color tile.

use tauri::image::Image;
use tauri::WebviewWindow;
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateIcon, SendMessageW, HICON, ICON_BIG, ICON_SMALL, WM_SETICON,
};

fn hicon_from_rgba(rgba: &[u8], width: u32, height: u32) -> Option<HICON> {
    let pixel_count = (width as usize).checked_mul(height as usize)?;
    if rgba.len() < pixel_count * 4 {
        return None;
    }

    let mut bgra = Vec::with_capacity(pixel_count * 4);
    let mut and_mask = Vec::with_capacity(pixel_count);
    for px in rgba.chunks_exact(4).take(pixel_count) {
        let (r, g, b, a) = (px[0], px[1], px[2], px[3]);
        bgra.extend_from_slice(&[b, g, r, a]);
        // Match tao: invert alpha into the legacy AND mask byte stream.
        and_mask.push(a.wrapping_sub(u8::MAX));
    }

    unsafe {
        CreateIcon(
            None,
            width as i32,
            height as i32,
            1,
            32,
            and_mask.as_ptr(),
            bgra.as_ptr(),
        )
        .ok()
    }
}

fn set_icon(hwnd: HWND, which: usize, icon: HICON) {
    unsafe {
        let _ = SendMessageW(
            hwnd,
            WM_SETICON,
            Some(WPARAM(which)),
            Some(LPARAM(icon.0 as isize)),
        );
    }
}

/// Apply both small (titlebar) and big (taskbar / Alt-Tab) icons.
pub fn apply_window_icons(win: &WebviewWindow) {
    let Ok(hwnd) = win.hwnd() else {
        return;
    };

    let small = Image::from_bytes(include_bytes!("../icons/32x32.png")).ok();
    let big = Image::from_bytes(include_bytes!("../icons/128x128.png")).ok();

    if let Some(img) = &small {
        if let Some(hicon) = hicon_from_rgba(img.rgba(), img.width(), img.height()) {
            set_icon(hwnd, ICON_SMALL as usize, hicon);
            // Do not DestroyIcon — Windows owns the handle after WM_SETICON.
        }
        let _ = win.set_icon(img.clone());
    }

    if let Some(img) = &big {
        if let Some(hicon) = hicon_from_rgba(img.rgba(), img.width(), img.height()) {
            set_icon(hwnd, ICON_BIG as usize, hicon);
        }
    } else if let Some(img) = &small {
        if let Some(hicon) = hicon_from_rgba(img.rgba(), img.width(), img.height()) {
            set_icon(hwnd, ICON_BIG as usize, hicon);
        }
    }
}
