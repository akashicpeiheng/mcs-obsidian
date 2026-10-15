import Targets

namespace MCSObsidian.Verified

theorem rowEquivalence : MCSObsidian.Expected.rowEquivalence := by
  intro F _ V _ _ W _ _ T E x b
  exact E.injective.eq_iff

theorem affineFibre : MCSObsidian.Expected.affineFibre := by
  intro F _ V _ _ W _ _ T x x₀ b hx₀
  rw [LinearMap.mem_ker, map_sub, hx₀, sub_eq_zero]

theorem rankNullity : MCSObsidian.Expected.rankNullity := by
  intro F _ V _ _ W _ _ _ T
  exact T.finrank_range_add_finrank_ker

end MCSObsidian.Verified
