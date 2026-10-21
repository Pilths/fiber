import { useEffect, useState } from 'react'

export default function App() {
  const [health, setHealth] = useState('checking...')

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setHealth(`${d.status}, PostGIS ${d.postgis}`))
      .catch((e) => setHealth(`error: ${e}`))
  }, [])

  return (
    <main className="p-8 font-sans">
      <h1 className="text-2xl font-semibold">Fiber Dashboard</h1>
      <p className="mt-2">API health: {health}</p>
    </main>
  )
}
