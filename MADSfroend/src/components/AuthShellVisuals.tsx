export function IconUser() {
  return (
    <svg className="auth-field-icon" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" d="M12 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path strokeLinecap="round" d="M6 20.5v-1.2A4.3 4.3 0 0 1 10.3 15h3.4A4.3 4.3 0 0 1 18 19.3v1.2" />
    </svg>
  );
}

export function IconLock() {
  return (
    <svg className="auth-field-icon" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path strokeLinecap="round" d="M9 11V8a3 3 0 0 1 6 0v3" />
    </svg>
  );
}

export function AuthHeroIllustration() {
  return (
    <svg className="auth-hero-art" viewBox="0 0 360 280" role="img" aria-label="插画：服务台交流场景">
      <defs>
        <linearGradient id="auth-desk-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <linearGradient id="auth-skin-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fecaca" />
          <stop offset="100%" stopColor="#fdba74" />
        </linearGradient>
      </defs>
      <ellipse cx="180" cy="252" rx="130" ry="18" fill="#bfdbfe" opacity="0.5" />
      <rect x="48" y="168" width="264" height="22" rx="8" fill="url(#auth-desk-gradient)" opacity="0.95" />
      <rect x="40" y="120" width="280" height="56" rx="12" fill="#93c5fd" opacity="0.35" />
      <circle cx="118" cy="88" r="28" fill="url(#auth-skin-gradient)" />
      <path
        d="M90 125c8-18 22-28 40-30 24-3 48 10 56 32 4 12 5 26 2 40H78c-4-18 0-34 12-42Z"
        fill="#1e40af"
        opacity="0.9"
      />
      <circle cx="238" cy="72" r="26" fill="url(#auth-skin-gradient)" />
      <path
        d="M214 108c12-22 34-34 56-26 14 6 22 22 21 42h-94c-2-20 6-35 17-44Z"
        fill="#dbeafe"
        stroke="#93c5fd"
        strokeWidth="2"
      />
      <rect x="236" y="132" width="36" height="48" rx="6" fill="#60a5fa" />
      <rect x="268" y="112" width="8" height="68" rx="2" fill="#94a3b8" opacity="0.5" />
    </svg>
  );
}

export function AuthShellAside() {
  return (
    <aside className="auth-hero">
      <div className="auth-hero-logo">
        <div className="auth-hero-logo-mark" aria-hidden />
        <span>MADS</span>
      </div>
      <AuthHeroIllustration />
    </aside>
  );
}
