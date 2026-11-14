use std::sync::OnceLock;

/// Canonical GEDCOM 5.5.1 uppercase 3-letter month names.
const GEDCOM_MONTHS: [&str; 12] = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SimpleDate {
    pub year: i32,
    pub month: Option<u8>, // 1..=12
    pub day: Option<u8>,   // 1..=31
}

impl SimpleDate {
    pub fn to_gedcom(&self) -> String {
        match (self.day, self.month) {
            (Some(d), Some(m)) if (1..=12).contains(&m) => {
                format!("{:02} {} {}", d, GEDCOM_MONTHS[(m - 1) as usize], self.year)
            }
            (None, Some(m)) if (1..=12).contains(&m) => {
                format!("{} {}", GEDCOM_MONTHS[(m - 1) as usize], self.year)
            }
            _ => format!("{}", self.year),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GedcomDateExpr {
    Exact(SimpleDate),
    Approx { qualifier: &'static str, date: SimpleDate }, // ABT | CAL | EST
    RangeSingle { qualifier: &'static str, date: SimpleDate }, // BEF | AFT | FROM | TO
    Between { start: SimpleDate, end: SimpleDate }, // BET ... AND ...
    Period { start: SimpleDate, end: SimpleDate }, // FROM ... TO ...
    Interpreted { date: SimpleDate, phrase: String }, // INT ... (...)
    Phrase(String), // (...)
}

impl GedcomDateExpr {
    pub fn to_gedcom(&self) -> String {
        match self {
            GedcomDateExpr::Exact(d) => d.to_gedcom(),
            GedcomDateExpr::Approx { qualifier, date } => format!("{} {}", qualifier, date.to_gedcom()),
            GedcomDateExpr::RangeSingle { qualifier, date } => format!("{} {}", qualifier, date.to_gedcom()),
            GedcomDateExpr::Between { start, end } => {
                format!("BET {} AND {}", start.to_gedcom(), end.to_gedcom())
            }
            GedcomDateExpr::Period { start, end } => {
                format!("FROM {} TO {}", start.to_gedcom(), end.to_gedcom())
            }
            GedcomDateExpr::Interpreted { date, phrase } => {
                format!("INT {} ({})", date.to_gedcom(), phrase)
            }
            GedcomDateExpr::Phrase(p) => {
                let trimmed = p.trim();
                if trimmed.starts_with('(') && trimmed.ends_with(')') {
                    trimmed.to_string()
                } else {
                    format!("({})", trimmed)
                }
            }
        }
    }
}

fn parse_month_token(token: &str) -> Option<u8> {
    let clean = token.trim().trim_end_matches('.').to_uppercase();
    match clean.as_str() {
        "JAN" | "JANUAR" | "JANUARY" | "JANVIER" | "JANEIRO" => Some(1),
        "FEB" | "FEBRUAR" | "FEBRUARY" | "FEV" | "FÉV" | "FEVR" | "FÉVR" | "FEVRIER" | "FÉVRIER" | "FEVEREIRO" => Some(2),
        "MAR" | "MÄR" | "MRZ" | "MAER" | "MAERZ" | "MÄRZ" | "MARCH" | "MARS" | "MARÇO" | "MARCO" => Some(3),
        "APR" | "APRIL" | "AVR" | "AVRIL" | "ABR" | "ABRIL" => Some(4),
        "MAY" | "MAI" | "MAIO" => Some(5),
        "JUN" | "JUNI" | "JUNE" | "JUIN" | "JUNHO" => Some(6),
        "JUL" | "JULI" | "JULY" | "JUIL" | "JUILLET" | "JULHO" => Some(7),
        "AUG" | "AUGUST" | "AOÛ" | "AOU" | "AOÛT" | "AOUT" | "AGO" | "AGOSTO" => Some(8),
        "SEP" | "SEPT" | "SEPTEMBER" | "SEPTEMBRE" | "SET" | "SETEMBRO" => Some(9),
        "OCT" | "OKT" | "OKTOBER" | "OCTOBER" | "OCTOBRE" | "OUT" | "OUTUBRO" => Some(10),
        "NOV" | "NOVEMBER" | "NOVEMBRE" | "NOVEMBRO" => Some(11),
        "DEC" | "DEZ" | "DEZEMBER" | "DECEMBER" | "DÉC" | "DECEMBRE" | "DÉCEMBRE" | "DEZEMBRO" => Some(12),
        _ => None,
    }
}

fn is_valid_day_month(day: u8, month: u8) -> bool {
    (1..=12).contains(&month) && (1..=31).contains(&day)
}

/// Parses a single date (without range/approx prefix) into `SimpleDate`.
pub fn parse_simple_date(input: &str) -> Option<SimpleDate> {
    let s = input.trim();
    if s.is_empty() {
        return None;
    }

    // 1. ISO: YYYY-MM-DD or YYYY-MM
    if let Some((y_str, rest)) = s.split_once('-') {
        if y_str.len() == 4 && y_str.chars().all(|c| c.is_ascii_digit()) {
            let year = y_str.parse::<i32>().ok()?;
            let rest_parts: Vec<&str> = rest.split('-').collect();
            if rest_parts.len() == 1 {
                if let Ok(m) = rest_parts[0].trim().parse::<u8>() {
                    if (1..=12).contains(&m) {
                        return Some(SimpleDate { year, month: Some(m), day: None });
                    }
                }
            } else if rest_parts.len() == 2 {
                let m = rest_parts[0].trim().parse::<u8>().ok()?;
                let d = rest_parts[1].trim().parse::<u8>().ok()?;
                if is_valid_day_month(d, m) {
                    return Some(SimpleDate { year, month: Some(m), day: Some(d) });
                }
            }
        }
    }

    // 2. Dot-separated: DD.MM.YYYY or MM.YYYY or "DD. MMM YYYY"
    if s.contains('.') {
        let dot_parts: Vec<&str> = s.split('.').map(str::trim).filter(|p| !p.is_empty()).collect();
        if dot_parts.len() == 3
            && dot_parts[0].chars().all(|c| c.is_ascii_digit())
            && dot_parts[1].chars().all(|c| c.is_ascii_digit())
            && (3..=4).contains(&dot_parts[2].len())
            && dot_parts[2].chars().all(|c| c.is_ascii_digit())
        {
            let d = dot_parts[0].parse::<u8>().ok()?;
            let m = dot_parts[1].parse::<u8>().ok()?;
            let y = dot_parts[2].parse::<i32>().ok()?;
            if is_valid_day_month(d, m) {
                return Some(SimpleDate { year: y, month: Some(m), day: Some(d) });
            }
        } else if dot_parts.len() == 2
            && dot_parts[0].chars().all(|c| c.is_ascii_digit())
            && (3..=4).contains(&dot_parts[1].len())
            && dot_parts[1].chars().all(|c| c.is_ascii_digit())
        {
            let m = dot_parts[0].parse::<u8>().ok()?;
            let y = dot_parts[1].parse::<i32>().ok()?;
            if (1..=12).contains(&m) {
                return Some(SimpleDate { year: y, month: Some(m), day: None });
            }
        }
    }

    // 3. Slash-separated: YYYY/MM/DD, DD/MM/YYYY, MM/DD/YYYY, MM/YYYY
    if s.contains('/') && !s.contains(' ') {
        let slash_parts: Vec<&str> = s.split('/').map(str::trim).collect();
        if slash_parts.len() == 3 && slash_parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit())) {
            if slash_parts[0].len() == 4 {
                let y = slash_parts[0].parse::<i32>().ok()?;
                let m = slash_parts[1].parse::<u8>().ok()?;
                let d = slash_parts[2].parse::<u8>().ok()?;
                if is_valid_day_month(d, m) {
                    return Some(SimpleDate { year: y, month: Some(m), day: Some(d) });
                }
            } else if (3..=4).contains(&slash_parts[2].len()) {
                let a = slash_parts[0].parse::<u8>().ok()?;
                let b = slash_parts[1].parse::<u8>().ok()?;
                let y = slash_parts[2].parse::<i32>().ok()?;
                // If second > 12, it must be MM/DD/YYYY; otherwise default DD/MM/YYYY
                if b > 12 && (1..=12).contains(&a) && b <= 31 {
                    return Some(SimpleDate { year: y, month: Some(a), day: Some(b) });
                } else if is_valid_day_month(a, b) {
                    return Some(SimpleDate { year: y, month: Some(b), day: Some(a) });
                }
            }
        } else if slash_parts.len() == 2 && slash_parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit())) {
            if slash_parts[0].len() == 4 {
                let y = slash_parts[0].parse::<i32>().ok()?;
                let m = slash_parts[1].parse::<u8>().ok()?;
                if (1..=12).contains(&m) {
                    return Some(SimpleDate { year: y, month: Some(m), day: None });
                }
            } else if (3..=4).contains(&slash_parts[1].len()) {
                let m = slash_parts[0].parse::<u8>().ok()?;
                let y = slash_parts[1].parse::<i32>().ok()?;
                if (1..=12).contains(&m) {
                    return Some(SimpleDate { year: y, month: Some(m), day: None });
                }
            }
        }
    }

    // 4. Space-separated GEDCOM / natural format: "DD MMM YYYY", "DD. MMM YYYY", "MMM YYYY", "YYYY"
    let tokens: Vec<String> = s
        .split_whitespace()
        .map(|t| t.trim_end_matches('.').trim_end_matches(',').to_string())
        .filter(|t| !t.is_empty())
        .collect();

    match tokens.as_slice() {
        [y_str] if (3..=4).contains(&y_str.len()) && y_str.chars().all(|c| c.is_ascii_digit()) => {
            let year = y_str.parse::<i32>().ok()?;
            Some(SimpleDate { year, month: None, day: None })
        }
        [m_str, y_str]
            if (3..=4).contains(&y_str.len()) && y_str.chars().all(|c| c.is_ascii_digit()) =>
        {
            let month = parse_month_token(m_str)?;
            let year = y_str.parse::<i32>().ok()?;
            Some(SimpleDate { year, month: Some(month), day: None })
        }
        [d_str, m_str, y_str]
            if d_str.chars().all(|c| c.is_ascii_digit())
                && (3..=4).contains(&y_str.len())
                && y_str.chars().all(|c| c.is_ascii_digit()) =>
        {
            let day = d_str.parse::<u8>().ok()?;
            let month = parse_month_token(m_str)?;
            let year = y_str.parse::<i32>().ok()?;
            if is_valid_day_month(day, month) {
                Some(SimpleDate { year, month: Some(month), day: Some(day) })
            } else {
                None
            }
        }
        _ => None,
    }
}

fn split_pair_keyword<'a>(s: &'a str, keywords: &[&str]) -> Option<(&'a str, &'a str)> {
    let lower = s.to_lowercase();
    for kw in keywords {
        let pattern = format!(" {} ", kw);
        if let Some(idx) = lower.find(&pattern) {
            let left = s[..idx].trim();
            let right = s[idx + pattern.len()..].trim();
            if !left.is_empty() && !right.is_empty() {
                return Some((left, right));
            }
        }
    }
    None
}

fn strip_prefix_ci<'a>(s: &'a str, prefixes: &[&str]) -> Option<&'a str> {
    let trimmed = s.trim();
    let lower = trimmed.to_lowercase();
    for p in prefixes {
        if lower.starts_with(p) {
            let rest = &trimmed[p.len()..];
            if rest.is_empty() || rest.starts_with(char::is_whitespace) {
                let r = rest.trim();
                if !r.is_empty() {
                    return Some(r);
                }
            }
        }
    }
    None
}

/// Parses a full GEDCOM or localized date expression into `GedcomDateExpr`.
pub fn parse_date_expr(input: &str) -> Option<GedcomDateExpr> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Already a GEDCOM date phrase: "(...)"
    if trimmed.starts_with('(') && trimmed.ends_with(')') && trimmed.len() >= 2 {
        return Some(GedcomDateExpr::Phrase(trimmed[1..trimmed.len() - 1].trim().to_string()));
    }

    // INT <date> (<phrase>)
    if let Some(rest) = strip_prefix_ci(trimmed, &["int"]) {
        if let Some(paren_start) = rest.find('(') {
            if rest.ends_with(')') && paren_start > 0 {
                let date_part = rest[..paren_start].trim();
                let phrase_part = rest[paren_start + 1..rest.len() - 1].trim();
                if let Some(d) = parse_simple_date(date_part) {
                    return Some(GedcomDateExpr::Interpreted {
                        date: d,
                        phrase: phrase_part.to_string(),
                    });
                }
            }
        }
    }

    // BET ... AND ... / ZWISCHEN ... UND ... / ENTRE ... ET ... / ENTRE ... E ...
    if let Some(rest) = strip_prefix_ci(trimmed, &["bet", "between", "zwischen", "zw.", "zw", "entre"]) {
        if let Some((left, right)) = split_pair_keyword(rest, &["and", "und", "et", "e"]) {
            if let (Some(d1), Some(d2)) = (parse_simple_date(left), parse_simple_date(right)) {
                return Some(GedcomDateExpr::Between { start: d1, end: d2 });
            }
        }
    }

    // FROM ... TO ... / VON ... BIS ... / DE ... À ... / DE ... ATÉ ...
    if let Some(rest) = strip_prefix_ci(trimmed, &["from", "von", "de", "desde"]) {
        if let Some((left, right)) = split_pair_keyword(rest, &["to", "bis", "à", "a", "até", "ate"]) {
            if let (Some(d1), Some(d2)) = (parse_simple_date(left), parse_simple_date(right)) {
                return Some(GedcomDateExpr::Period { start: d1, end: d2 });
            }
        }
    }

    // Single-date qualifiers
    let single_qualifiers: &[(&str, bool, &[&str])] = &[
        ("BEF", false, &["bef", "before", "vor"]),
        ("AFT", false, &["aft", "after", "nach", "après", "apres", "depois de", "depois"]),
        ("ABT", true, &["abt", "about", "ca.", "ca", "cir.", "cir", "circa", "um", "etwa", "ungefähr", "ungefahr", "approx.", "approx", "env.", "environ", "cerca de"]),
        ("CAL", true, &["cal", "calculated", "ber.", "berechnet", "calculé", "calcule", "calculado"]),
        ("EST", true, &["est", "estimated", "gesch.", "geschätzt", "geschatzt", "estimé", "estime", "estimado"]),
        ("FROM", false, &["from", "ab", "von", "depuis", "desde"]),
        ("TO", false, &["to", "bis", "jusqu'à", "jusqu'a", "até", "ate"]),
    ];

    for (gedcom_kw, is_approx, prefixes) in single_qualifiers {
        if let Some(rest) = strip_prefix_ci(trimmed, prefixes) {
            if let Some(d) = parse_simple_date(rest) {
                if *is_approx {
                    return Some(GedcomDateExpr::Approx {
                        qualifier: gedcom_kw,
                        date: d,
                    });
                } else {
                    return Some(GedcomDateExpr::RangeSingle {
                        qualifier: gedcom_kw,
                        date: d,
                    });
                }
            }
        }
    }

    // Plain simple date
    if let Some(d) = parse_simple_date(trimmed) {
        return Some(GedcomDateExpr::Exact(d));
    }

    None
}

/// Normalizes user input or imported date strings for database storage.
/// If the input can be parsed into a canonical GEDCOM 5.5.1 date expression,
/// returns the canonical GEDCOM string (e.g., `BEF 15 MAY 1950`).
/// Otherwise preserves the trimmed input so no user data is lost.
pub fn normalize_date_for_storage(input: Option<&str>) -> Option<String> {
    let trimmed = input?.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(expr) = parse_date_expr(trimmed) {
        Some(expr.to_gedcom())
    } else {
        Some(trimmed.to_string())
    }
}

/// Formats any stored date string into a valid GEDCOM 5.5.1 `DATE` value for export.
/// Unparseable free-text strings are wrapped in parentheses `(...)` as GEDCOM date phrases.
pub fn format_for_gedcom_export(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if let Some(expr) = parse_date_expr(trimmed) {
        expr.to_gedcom()
    } else if trimmed.starts_with('(') && trimmed.ends_with(')') {
        trimmed.to_string()
    } else {
        format!("({})", trimmed)
    }
}

/// Returns a comparable `(year, month, day)` tuple for chronological sorting.
pub fn parse_sort_key(date: &str) -> (i32, i32, i32) {
    let trimmed = date.trim();
    if trimmed.is_empty() {
        return (9999, 99, 99);
    }

    if let Some(expr) = parse_date_expr(trimmed) {
        let d_opt = match expr {
            GedcomDateExpr::Exact(d)
            | GedcomDateExpr::Approx { date: d, .. }
            | GedcomDateExpr::RangeSingle { date: d, .. }
            | GedcomDateExpr::Interpreted { date: d, .. } => Some(d),
            GedcomDateExpr::Between { start, .. } | GedcomDateExpr::Period { start, .. } => Some(start),
            GedcomDateExpr::Phrase(_) => None,
        };
        if let Some(d) = d_opt {
            return (
                d.year,
                d.month.map(|m| m as i32).unwrap_or(99),
                d.day.map(|day| day as i32).unwrap_or(99),
            );
        }
    }

    // Fallback: extract any 4-digit year if present
    static YEAR_FALLBACK: OnceLock<()> = OnceLock::new();
    let _ = YEAR_FALLBACK.get_or_init(|| ());
    for token in trimmed.split(|c: char| !c.is_ascii_digit()) {
        if token.len() == 4 {
            if let Ok(y) = token.parse::<i32>() {
                return (y, 99, 99);
            }
        }
    }

    (9999, 99, 99)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_exact_and_partial_dates() {
        assert_eq!(normalize_date_for_storage(Some("15.05.1950")).as_deref(), Some("15 MAY 1950"));
        assert_eq!(normalize_date_for_storage(Some("1950-05-15")).as_deref(), Some("15 MAY 1950"));
        assert_eq!(normalize_date_for_storage(Some("05.1950")).as_deref(), Some("MAY 1950"));
        assert_eq!(normalize_date_for_storage(Some("1950-05")).as_deref(), Some("MAY 1950"));
        assert_eq!(normalize_date_for_storage(Some("1950")).as_deref(), Some("1950"));
        assert_eq!(normalize_date_for_storage(Some("15 MAY 1950")).as_deref(), Some("15 MAY 1950"));
    }

    #[test]
    fn test_normalize_qualifiers_and_ranges() {
        assert_eq!(normalize_date_for_storage(Some("vor 1890")).as_deref(), Some("BEF 1890"));
        assert_eq!(normalize_date_for_storage(Some("nach 12.03.1920")).as_deref(), Some("AFT 12 MAR 1920"));
        assert_eq!(normalize_date_for_storage(Some("ca. 1900")).as_deref(), Some("ABT 1900"));
        assert_eq!(normalize_date_for_storage(Some("um 05.1885")).as_deref(), Some("ABT MAY 1885"));
        assert_eq!(normalize_date_for_storage(Some("zwischen 1880 und 1885")).as_deref(), Some("BET 1880 AND 1885"));
        assert_eq!(normalize_date_for_storage(Some("von 1900 bis 1910")).as_deref(), Some("FROM 1900 TO 1910"));
        assert_eq!(normalize_date_for_storage(Some("ab 1925")).as_deref(), Some("FROM 1925"));
        assert_eq!(normalize_date_for_storage(Some("bis 1945")).as_deref(), Some("TO 1945"));
    }

    #[test]
    fn test_gedcom_export_formatting() {
        assert_eq!(format_for_gedcom_export("15.05.1950"), "15 MAY 1950");
        assert_eq!(format_for_gedcom_export("vor 1890"), "BEF 1890");
        assert_eq!(format_for_gedcom_export("unbekanntes Datum"), "(unbekanntes Datum)");
        assert_eq!(format_for_gedcom_export("(Sommer 1920)"), "(Sommer 1920)");
    }

    #[test]
    fn test_sort_key() {
        assert_eq!(parse_sort_key("15 MAY 1950"), (1950, 5, 15));
        assert_eq!(parse_sort_key("BEF 12.03.1920"), (1920, 3, 12));
        assert_eq!(parse_sort_key("BET 1880 AND 1890"), (1880, 99, 99));
        assert_eq!(parse_sort_key(""), (9999, 99, 99));
    }
}
