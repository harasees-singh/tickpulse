import { helpText, type HelpId } from '../core/help'

// One ⓘ tooltip affordance (DEV_PLAN §1.C). The registry copy feeds both the
// native `title` (hover) and `aria-label` (assistive tech) as the design's
// "How: … · Means: …" line — no deps, no positioning math, reduced-motion safe
// by construction. Keyboard-focusable for accessibility.
export function InfoTip(props: { id: HelpId }) {
  const txt = () => helpText(props.id)
  return (
    <span class="infotip material-symbols-outlined" role="img" tabindex="0" title={txt()} aria-label={txt()}>
      info
    </span>
  )
}

