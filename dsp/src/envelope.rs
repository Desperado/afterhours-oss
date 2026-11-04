//! Retriggerable ADSR with a finite, click-free release from the current level.
#[derive(Clone, Copy)]
pub struct Adsr {
    pub attack: f32,
    pub decay: f32,
    pub sustain: f32,
    pub release: f32,
}
#[derive(PartialEq)]
enum Stage {
    Idle,
    Attack,
    Decay,
    Sustain,
    Release,
}
pub struct Envelope {
    stage: Stage,
    value: f32,
    step: f32,
    gate: bool,
}
impl Envelope {
    pub fn new() -> Self {
        Self {
            stage: Stage::Idle,
            value: 0.0,
            step: 0.0,
            gate: false,
        }
    }
    pub fn is_idle(&self) -> bool {
        self.stage == Stage::Idle
    }
    pub fn tick(&mut self, gate: bool, adsr: Adsr, rate: f32) -> f32 {
        if gate != self.gate {
            self.gate = gate;
            if gate {
                self.stage = Stage::Attack;
                self.step = (1.0 - self.value) / (adsr.attack * rate).max(1.0);
            } else {
                self.stage = Stage::Release;
                self.step = self.value / (adsr.release * rate).max(1.0);
            }
        }
        match self.stage {
            Stage::Attack => {
                self.value = (self.value + self.step).min(1.0);
                if self.value >= 0.99999 {
                    self.value = 1.0;
                    self.stage = Stage::Decay;
                    self.step = 1.0 - (-5.0 / (adsr.decay * rate).max(1.0)).exp();
                }
            }
            Stage::Decay => {
                self.value += (adsr.sustain - self.value) * self.step;
                if (self.value - adsr.sustain).abs() < 0.00001 {
                    self.stage = Stage::Sustain;
                }
            }
            Stage::Sustain => self.value = adsr.sustain,
            Stage::Release => {
                self.value = (self.value - self.step).max(0.0);
                if self.value < 0.00001 {
                    self.value = 0.0;
                    self.stage = Stage::Idle;
                }
            }
            Stage::Idle => {}
        }
        self.value
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn release_and_retrigger_continue_from_the_current_level() {
        let mut env = Envelope::new();
        let adsr = Adsr {
            attack: 0.1,
            decay: 0.1,
            sustain: 0.5,
            release: 0.1,
        };
        for _ in 0..50 {
            env.tick(true, adsr, 1000.0);
        }
        let before = env.value;
        assert!((env.tick(false, adsr, 1000.0) - before).abs() < 0.01);
        for _ in 0..50 {
            env.tick(false, adsr, 1000.0);
        }
        let before = env.value;
        assert!((env.tick(true, adsr, 1000.0) - before).abs() < 0.01);
        env.tick(false, adsr, 1000.0);
        for _ in 0..101 {
            env.tick(false, adsr, 1000.0);
        }
        assert_eq!(env.value, 0.0);
    }
}
