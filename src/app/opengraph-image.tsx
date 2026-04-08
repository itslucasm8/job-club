import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Job Club — Jobs for Backpackers in Australia'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #1e1145 0%, #581c87 50%, #6b21a8 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '60px 80px',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Eyebrow */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <div style={{ width: '40px', height: '3px', background: '#f59e0b', borderRadius: '2px' }} />
          <span style={{ fontSize: '16px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '2px' }}>
            Job Club
          </span>
        </div>

        {/* Title */}
        <h1 style={{ fontSize: '64px', fontWeight: 800, color: '#f5f3ff', lineHeight: 1.1, margin: '0 0 20px 0', maxWidth: '800px' }}>
          Jobs for Backpackers in Australia
        </h1>

        {/* Subtitle */}
        <p style={{ fontSize: '24px', color: '#c4b5fd', margin: '0 0 40px 0', maxWidth: '600px' }}>
          900+ curated listings across all 8 states. Farm work, hospitality, construction & more.
        </p>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: '48px' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '36px', fontWeight: 800, color: '#ffffff' }}>900+</span>
            <span style={{ fontSize: '13px', color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '1.5px' }}>Jobs</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '36px', fontWeight: 800, color: '#ffffff' }}>8</span>
            <span style={{ fontSize: '13px', color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '1.5px' }}>States</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '36px', fontWeight: 800, color: '#ffffff' }}>9</span>
            <span style={{ fontSize: '13px', color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '1.5px' }}>Categories</span>
          </div>
        </div>

        {/* Domain */}
        <div style={{ position: 'absolute', bottom: '40px', right: '60px', fontSize: '18px', color: '#7c3aed', fontWeight: 600 }}>
          thejobclub.com.au
        </div>
      </div>
    ),
    { ...size }
  )
}
