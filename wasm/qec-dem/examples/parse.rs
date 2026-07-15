use std::io::Read;
fn main() {
    let max: usize = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(1_000_000);
    let mut text = String::new();
    std::io::stdin().read_to_string(&mut text).unwrap();
    println!("{}", qec_dem::parse_to_json(&text, max));
}
