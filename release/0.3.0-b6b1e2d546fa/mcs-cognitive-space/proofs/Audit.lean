import Verified
import Lean.Elab.Command
import Lean.Util.CollectAxioms

open Lean Elab Command

elab "mcs_obsidian_audit" : command => do
  let env ← getEnv
  let targets : Array (Name × Name) := #[
    (`MCSObsidian.Verified.rowEquivalence, `MCSObsidian.Expected.rowEquivalence),
    (`MCSObsidian.Verified.affineFibre, `MCSObsidian.Expected.affineFibre),
    (`MCSObsidian.Verified.rankNullity, `MCSObsidian.Expected.rankNullity)]
  let mut results : Array Json := #[]
  for (decl, expected) in targets do
    let some info := env.find? decl | throwError "missing target: {decl}"
    let .thmInfo _ := info | throwError "not a theorem: {decl}"
    unless info.type.getAppFn.constName? == some expected do
      throwError "target mismatch: {decl}"
    let axioms ← Lean.collectAxioms decl
    for ax in axioms do
      unless [``propext, ``Classical.choice, ``Quot.sound].contains ax do
        throwError "unapproved axiom: {ax}"
    results := results.push (Json.mkObj [
      ("declaration", toJson decl.toString), ("expected", toJson expected.toString),
      ("axioms", toJson (axioms.map Name.toString)), ("targetMatched", toJson true)])
  liftIO <| IO.println ("MCS_OBSIDIAN_AUDIT:" ++ (Json.mkObj [("targets", toJson results)]).compress)

mcs_obsidian_audit
