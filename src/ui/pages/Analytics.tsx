// Placeholder — built in Core C. Deep-linkable per-symbol view: /analytics/:symbol
import { useParams } from '@solidjs/router'

export default function Analytics() {
  const params = useParams()
  return (
    <div class="content-head">
      <div>
        <h2 class="content-title">Analytics{params.symbol ? ' · ' + params.symbol : ''}</h2>
        <p class="content-sub">
          {params.symbol
            ? `Per-symbol deep dive for ${params.symbol} — chart, depth ladder and CVD. Coming soon.`
            : 'Select a symbol to open its deep dive. Coming soon.'}
        </p>
      </div>
    </div>
  )
}

