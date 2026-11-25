// La acreditación ampliada del archivo (T02/T05) y la decisión actual por apuesta
// son controles distintos. Observar una suspensión histórica no es necesario
// para descartar una selección suspendida ahora: eso se exige a cada cuota.
export const LIVE_REQUIRED_CHECKS=['catalog','rules','source-samples','controlled-faults','free-budget'] as const;
export function recommendationReadiness(acceptance:any) {
  const checks=Array.isArray(acceptance?.checks)?acceptance.checks:[];
  const missing=LIVE_REQUIRED_CHECKS.filter(id=>checks.filter((c:any)=>c.id===id).length!==1||checks.find((c:any)=>c.id===id)?.passed!==true);
  return {ready:missing.length===0,missing,policy:'manual-per-selection-v1',
    pendingEvidence:checks.filter((c:any)=>c.passed!==true&&!LIVE_REQUIRED_CHECKS.includes(c.id)).map((c:any)=>({id:c.id,detail:c.detail})),
    note:'Cada apuesta exige además modelo y selección evaluados, datos deportivos completos, cuota vigente, contraste español exacto, saldo reciente e importe dentro de límites. La acreditación histórica pendiente permanece visible.'};
}
