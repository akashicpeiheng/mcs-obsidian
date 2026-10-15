import Mathlib.LinearAlgebra.FiniteDimensional.Lemmas

namespace MCSObsidian.Expected
universe u v w

def rowEquivalence : Prop :=
  ∀ (F : Type u) [Field F] (V : Type v) [AddCommGroup V] [Module F V]
    (W : Type w) [AddCommGroup W] [Module F W]
    (T : V →ₗ[F] W) (E : W ≃ₗ[F] W) (x : V) (b : W),
    E (T x) = E b ↔ T x = b

def affineFibre : Prop :=
  ∀ (F : Type u) [Field F] (V : Type v) [AddCommGroup V] [Module F V]
    (W : Type w) [AddCommGroup W] [Module F W]
    (T : V →ₗ[F] W) (x x₀ : V) (b : W),
    T x₀ = b → (T x = b ↔ x - x₀ ∈ LinearMap.ker T)

def rankNullity : Prop :=
  ∀ (F : Type u) [Field F] (V : Type v) [AddCommGroup V] [Module F V]
    (W : Type w) [AddCommGroup W] [Module F W] [FiniteDimensional F V]
    (T : V →ₗ[F] W),
    Module.finrank F (LinearMap.range T) + Module.finrank F (LinearMap.ker T) = Module.finrank F V

end MCSObsidian.Expected
