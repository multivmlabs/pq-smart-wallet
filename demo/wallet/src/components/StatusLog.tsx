export interface LogEntry {
  timestamp: number
  type: 'info' | 'success' | 'error' | 'warning'
  message: string
}

interface StatusLogProps {
  entries: LogEntry[]
}

const typeColors = {
  info: '#3b82f6',
  success: '#4ade80',
  error: '#ef4444',
  warning: '#f59e0b',
}

export function StatusLog({ entries }: StatusLogProps) {
  if (entries.length === 0) return null

  return (
    <div style={{
      border: '1px solid #333',
      borderRadius: 8,
      padding: 16,
    }}>
      <h3 style={{ fontSize: 14, marginBottom: 12 }}>Activity Log</h3>
      <div style={{
        maxHeight: 300,
        overflowY: 'auto',
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 1.6,
      }}>
        {entries.map((entry, i) => (
          <div key={i} style={{ color: typeColors[entry.type], marginBottom: 2 }}>
            <span style={{ color: '#555' }}>
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
            {' '}
            {entry.message}
          </div>
        ))}
      </div>
    </div>
  )
}
