//! Seeded, reproducible drift/noise and smoothing shared by realtime and offline rendering.
pub struct Modulation {
    seed: u32,
    drift: f32,
    phase: f32,
}
impl Modulation {
    pub fn new(seed: u32) -> Self {
        Self {
            seed: seed.max(1),
            drift: 0.0,
            phase: 0.0,
        }
    }
    pub fn tick(&mut self, rate: f32, speed: f32) -> (f32, f32, f32) {
        self.seed = self.seed.wrapping_mul(1664525).wrapping_add(1013904223);
        let noise = self.seed as f32 / 2147483648.0 - 1.0;
        self.drift += (noise * 30.0 - self.drift) * (1.0 / rate);
        self.phase = (self.phase + speed / rate).fract();
        (
            (std::f32::consts::TAU * self.phase).sin(),
            self.drift,
            noise,
        )
    }
}
pub fn smooth(value: &mut f32, target: f32, coefficient: f32) -> f32 {
    *value += (target - *value) * coefficient;
    *value
}
