//! Polynomial sine for hot loops: WebAssembly has no trigonometric instructions, and the
//! software libm sin/cos (with its range reduction) dominated per-sample filter updates.
use std::f64::consts::TAU;

/// sin(2πp) for any phase `p` in cycles; error < 2e-7.
pub fn sine(phase: f64) -> f64 {
    sine_cycle(phase - phase.floor())
}

/// sin(2πp) for a phase already wrapped to [0, 1): branch-free quarter-wave folding (abs and
/// copysign are single WebAssembly instructions) and a minimax polynomial; error < 4e-9.
pub fn sine_cycle(phase: f64) -> f64 {
    // sin(2πp) = −sin(2πy) with y = p − ½; fold |y| into the first quarter.
    let y = phase - 0.5;
    let quarter = 0.25 - (y.abs() - 0.25).abs();
    let z = quarter * TAU;
    let z2 = z * z;
    // Minimax odd polynomial of degree 9 on [0, π/2]: error < 4e-9.
    let value = z
        * (0.999_999_976_608_433_6
            + z2 * (-0.166_666_476_398_544_76
                + z2 * (0.008_332_899_869_070_508
                    + z2 * (-0.000_198_008_993_124_512_46 + z2 * 2.590_490_222_242_311e-6))));
    value.copysign(-y)
}

/// sin(x) for |x| ≤ π/2 to double precision (Taylor series to x¹⁹, Horner form).
pub fn sin_quarter(x: f64) -> f64 {
    // (−1)^k / (2k+1)! for k = 1..9.
    const C: [f64; 9] = [
        -1.0 / 6.0,
        1.0 / 120.0,
        -1.0 / 5040.0,
        1.0 / 362880.0,
        -1.0 / 39916800.0,
        1.0 / 6227020800.0,
        -1.0 / 1307674368000.0,
        1.0 / 355687428096000.0,
        -1.0 / 121645100408832000.0,
    ];
    let x2 = x * x;
    let mut sum = C[8];
    for c in C[..8].iter().rev() {
        sum = sum * x2 + c;
    }
    x + x * x2 * sum
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn polynomials_match_the_library_sine() {
        for i in -2000..2000 {
            let p = i as f64 / 997.0;
            assert!((sine(p) - (TAU * p).sin()).abs() < 2e-7, "{p}");
        }
        for i in 0..4096 {
            let p = i as f64 / 4096.0;
            assert!((sine_cycle(p) - (TAU * p).sin()).abs() < 2e-7, "{p}");
        }
        for i in 0..=1000 {
            let x = std::f64::consts::FRAC_PI_2 * i as f64 / 1000.0;
            assert!((sin_quarter(x) - x.sin()).abs() < 1e-15, "{x}");
        }
    }
}
