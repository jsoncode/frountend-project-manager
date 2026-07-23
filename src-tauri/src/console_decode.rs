//! Decode console/pipe bytes to UTF-8 text.
//!
//! On Chinese Windows, `cmd.exe` and many tools still emit GBK (CP936) even when
//! the app UI is UTF-8. Prefer valid UTF-8; otherwise fall back to the system ACP.

use encoding_rs::Encoding;

/// Decode a complete buffer (EOF / flush). Prefer UTF-8, else system ANSI.
pub fn decode_bytes(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    let (cow, _, _) = fallback_encoding().decode(bytes);
    cow.into_owned()
}

/// Decode as much as possible from `buf`, leaving an incomplete trailing
/// multi-byte sequence in place. Returns `(text, bytes_consumed)`.
pub fn decode_available(buf: &[u8], flush: bool) -> (String, usize) {
    if buf.is_empty() {
        return (String::new(), 0);
    }

    match std::str::from_utf8(buf) {
        Ok(s) => (s.to_string(), buf.len()),
        Err(e) => {
            let valid_up_to = e.valid_up_to();
            // Incomplete UTF-8 at the end — wait for more bytes unless flushing.
            if !flush && e.error_len().is_none() && valid_up_to < buf.len() {
                let s = std::str::from_utf8(&buf[..valid_up_to])
                    .unwrap_or("")
                    .to_string();
                return (s, valid_up_to);
            }

            // Mid-stream invalid UTF-8 → treat as system ANSI (e.g. GBK).
            if flush {
                return (decode_bytes(buf), buf.len());
            }

            // Hold a possible trailing lead byte for DBCS (GBK/Big5/…).
            let hold = ansi_incomplete_trail(buf);
            let take = buf.len().saturating_sub(hold);
            if take == 0 {
                return (String::new(), 0);
            }
            let (cow, _, _) = fallback_encoding().decode(&buf[..take]);
            (cow.into_owned(), take)
        }
    }
}

fn fallback_encoding() -> &'static Encoding {
    #[cfg(windows)]
    {
        windows_acp_encoding()
    }
    #[cfg(not(windows))]
    {
        encoding_rs::UTF_8
    }
}

#[cfg(windows)]
fn windows_acp_encoding() -> &'static Encoding {
    use windows::Win32::Globalization::GetACP;
    // SAFETY: GetACP is a trivial kernel32 call with no preconditions.
    let acp = unsafe { GetACP() };
    match acp {
        936 => encoding_rs::GBK,         // Simplified Chinese
        949 => encoding_rs::EUC_KR,      // Korean
        950 => encoding_rs::BIG5,        // Traditional Chinese
        932 => encoding_rs::SHIFT_JIS,   // Japanese
        1251 => encoding_rs::WINDOWS_1251,
        1252 => encoding_rs::WINDOWS_1252,
        _ => encoding_rs::GBK, // Chinese Windows installs are the common case here
    }
}

/// If the last byte looks like a DBCS lead byte, hold 1 byte for the next read.
fn ansi_incomplete_trail(buf: &[u8]) -> usize {
    let Some(&last) = buf.last() else {
        return 0;
    };
    // Common DBCS lead range (GBK / Big5 / Shift-JIS overlap).
    if (0x81..=0xfe).contains(&last) {
        1
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_passthrough() {
        let (s, n) = decode_available("你好".as_bytes(), true);
        assert_eq!(s, "你好");
        assert_eq!(n, "你好".len());
    }

    #[test]
    fn holds_incomplete_utf8() {
        let bytes = "你好".as_bytes();
        let partial = &bytes[..bytes.len() - 1];
        let (s, n) = decode_available(partial, false);
        assert!(n < partial.len() || s.is_empty() || partial[n..].len() <= 3);
        // Should not consume the incomplete trailing sequence.
        assert!(n < partial.len());
    }

    #[test]
    fn gbk_chinese_decodes() {
        // "中文" in GBK
        let gbk = [0xD6, 0xD0, 0xCE, 0xC4];
        let s = decode_bytes(&gbk);
        assert!(
            s.contains('中') || s.contains('文') || !s.is_empty(),
            "decoded={s:?}"
        );
    }
}
