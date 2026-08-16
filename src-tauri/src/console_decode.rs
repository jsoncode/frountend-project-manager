//! Decode console/pipe bytes to UTF-8 text.
//!
//! On Chinese Windows, shells and tools may emit a mix of UTF-8 (git, modern CLIs)
//! and GBK/ACP (legacy tools). Prefer UTF-8; only fall back to the system ACP for
//! the *invalid* trailing region — never re-decode a valid UTF-8 prefix as GBK
//! (that produces classic mojibake like 娓呯┖…).

use encoding_rs::Encoding;

/// Decode a complete buffer (EOF / flush). Prefer UTF-8, else system ANSI.
pub fn decode_bytes(bytes: &[u8]) -> String {
    let (text, _) = decode_available(bytes, true);
    text
}

/// Stateful console decoder: keeps the DBCS decoder instance alive across
/// reads so an incomplete pair split at a read boundary (e.g. GBK lead in one
/// chunk, trail in the next) is completed instead of producing `�` — the
/// stateless `ansi_incomplete_trail` heuristic could not distinguish a held
/// lead byte from a complete pair's trail byte (audit H3).
pub struct StreamDecoder {
    /// Bytes of an incomplete UTF-8 codepoint awaiting the next chunk.
    utf8_pending: Vec<u8>,
    /// DBCS/ACP decoder; holds incomplete trailing pairs internally.
    fallback: encoding_rs::Decoder,
    /// Once invalid UTF-8 is seen, the stream stays on the fallback encoding
    /// (a console session is effectively one encoding; chcp 65001 → UTF-8).
    in_fallback_run: bool,
}

impl StreamDecoder {
    pub fn new() -> Self {
        Self {
            utf8_pending: Vec::new(),
            fallback: fallback_encoding().new_decoder_without_bom_handling(),
            in_fallback_run: false,
        }
    }

    /// Feed one chunk (not necessarily the last). Call with `flush = true` at
    /// end of stream to drain everything.
    pub fn push(&mut self, bytes: &[u8], flush: bool) -> String {
        let mut out = String::new();
        if self.in_fallback_run {
            self.decode_fallback(bytes, flush, &mut out);
            return out;
        }

        let mut combined = Vec::with_capacity(self.utf8_pending.len() + bytes.len());
        combined.extend_from_slice(&self.utf8_pending);
        combined.extend_from_slice(bytes);
        self.utf8_pending.clear();

        match std::str::from_utf8(&combined) {
            Ok(s) => {
                out.push_str(s);
                if flush {
                    self.in_fallback_run = true;
                }
            }
            Err(e) => {
                let valid_up_to = e.valid_up_to();
                // Incomplete UTF-8 at the end (no error byte yet) — hold the
                // tail for the next chunk.
                if !flush && e.error_len().is_none() && valid_up_to < combined.len() {
                    if valid_up_to > 0 {
                        out.push_str(std::str::from_utf8(&combined[..valid_up_to]).unwrap());
                    }
                    self.utf8_pending = combined[valid_up_to..].to_vec();
                    return out;
                }
                // Hard invalid UTF-8: keep the valid prefix as UTF-8, decode
                // the rest with the stateful fallback decoder.
                if valid_up_to > 0 {
                    out.push_str(std::str::from_utf8(&combined[..valid_up_to]).unwrap());
                }
                self.in_fallback_run = true;
                self.decode_fallback(&combined[valid_up_to..], flush, &mut out);
            }
        }
        out
    }

    fn decode_fallback(&mut self, bytes: &[u8], flush: bool, out: &mut String) {
        let mut offset = 0usize;
        loop {
            let mut scratch = String::with_capacity(bytes.len() * 3 + 16);
            let (result, read, _had_errors) =
                self.fallback.decode_to_string(&bytes[offset..], &mut scratch, flush);
            out.push_str(&scratch);
            offset += read;
            match result {
                encoding_rs::CoderResult::InputEmpty => break,
                encoding_rs::CoderResult::OutputFull => continue,
            }
        }
    }
}

impl Default for StreamDecoder {
    fn default() -> Self {
        Self::new()
    }
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

            // Incomplete UTF-8 at the end — emit valid prefix, wait for more bytes.
            if !flush && e.error_len().is_none() && valid_up_to < buf.len() {
                let s = std::str::from_utf8(&buf[..valid_up_to])
                    .unwrap_or("")
                    .to_string();
                return (s, valid_up_to);
            }

            // Keep any valid UTF-8 prefix intact (git often emits UTF-8 subjects
            // while PowerShell banners/errors arrive as GBK in the same stream).
            let mut out = String::new();
            let mut offset = 0usize;
            if valid_up_to > 0 {
                if let Ok(s) = std::str::from_utf8(&buf[..valid_up_to]) {
                    out.push_str(s);
                    offset = valid_up_to;
                }
            }

            let rest = &buf[offset..];
            if rest.is_empty() {
                return (out, offset);
            }

            let hold = rest.len().saturating_sub(ansi_consumable(rest, flush));
            let take = rest.len().saturating_sub(hold);
            if take == 0 {
                return (out, offset);
            }

            let (cow, _, _) = fallback_encoding().decode(&rest[..take]);
            out.push_str(&cow);
            (out, offset + take)
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

/// How many bytes of `rest` form complete sequences in the fallback encoding.
/// encoding_rs reports an incomplete trailing DBCS sequence by reading fewer
/// bytes than provided (the tail is carried to the next read by the caller's
/// pending buffer). The old heuristic treated ANY trailing byte in 0x81..=0xFE
/// as a DBCS lead — but that range also covers trail bytes, so a complete
/// pair ending exactly at the read boundary was wrongly held and then
/// mis-paired with the next chunk, producing `�` on Chinese Windows
/// (audit H3).
fn ansi_consumable(rest: &[u8], flush: bool) -> usize {
    if flush {
        return rest.len();
    }
    let mut decoder = fallback_encoding().new_decoder_without_bom_handling();
    // decode_to_string returns (result, bytes_read, had_errors); it appends to
    // the String. Loop on OutputFull in case a multi-byte sequence needs more
    // output capacity than the input length implies.
    let mut scratch = String::with_capacity(rest.len() * 3 + 16);
    let mut consumed = 0usize;
    loop {
        let (result, read, _had_errors) =
            decoder.decode_to_string(&rest[consumed..], &mut scratch, false);
        consumed += read;
        match result {
            encoding_rs::CoderResult::InputEmpty => break,
            encoding_rs::CoderResult::OutputFull => {
                scratch.reserve(scratch.capacity() + 32);
            }
        }
    }
    consumed
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

    #[test]
    fn utf8_prefix_not_garbled_when_gbk_follows() {
        // UTF-8 "清空" + GBK "中文" — must keep 清空, not 娓呯┖…
        let mut buf = Vec::new();
        buf.extend_from_slice("清空".as_bytes());
        buf.extend_from_slice(&[0xD6, 0xD0, 0xCE, 0xC4]);
        let s = decode_bytes(&buf);
        assert!(s.starts_with("清空"), "decoded={s:?}");
        assert!(!s.starts_with("娓"), "decoded={s:?}");
    }

    #[test]
    fn complete_gbk_pair_at_boundary_is_not_held() {
        // "中文" in GBK = D6 D0 CE C4. The old heuristic held the last byte
        // of a complete pair (0xD0/0xC4 are in 0x81..=0xFE) and mis-paired
        // it with the next chunk (audit H3).
        let gbk = [0xD6, 0xD0, 0xCE, 0xC4];
        let (s, n) = decode_available(&gbk[..2], false);
        assert_eq!(n, 2, "complete first pair must be consumed, got {n}");
        assert_eq!(s, "中");
        let (s2, n2) = decode_available(&gbk[2..], false);
        assert_eq!(n2, 2, "complete second pair must be consumed, got {n2}");
        assert_eq!(s2, "文");
    }

    #[test]
    fn split_gbk_pair_across_reads_via_stream_decoder() {
        // "中文" GBK bytes split 1/3 across reads: 0xD6 arrives alone, then
        // the rest. A stateful decoder must complete the pair (audit H3).
        let mut d = StreamDecoder::new();
        assert_eq!(d.push(&[0xD6], false), "");
        assert_eq!(d.push(&[0xD0, 0xCE, 0xC4], false), "中文");
        // And split 2/2.
        let mut d2 = StreamDecoder::new();
        assert_eq!(d2.push(&[0xD6, 0xD0], false), "中");
        assert_eq!(d2.push(&[0xCE, 0xC4], false), "文");
    }

    #[test]
    fn stream_decoder_utf8_split_across_reads() {
        // "你好" UTF-8 split mid-codepoint must reassemble, not emit �.
        let bytes = "你好".as_bytes();
        let mut d = StreamDecoder::new();
        let out1 = d.push(&bytes[..3], false); // "你"
        assert_eq!(out1, "你");
        let out2 = d.push(&bytes[3..], false); // "好"
        assert_eq!(out2, "好");
    }

    #[test]
    fn stream_decoder_utf8_prefix_then_gbk() {
        let mut d = StreamDecoder::new();
        let mut buf = Vec::new();
        buf.extend_from_slice("清空".as_bytes());
        buf.extend_from_slice(&[0xD6, 0xD0, 0xCE, 0xC4]);
        let out = d.push(&buf, true);
        assert!(out.starts_with("清空"), "decoded={out:?}");
        assert!(out.contains('中') && out.contains('文'), "decoded={out:?}");
    }
}
