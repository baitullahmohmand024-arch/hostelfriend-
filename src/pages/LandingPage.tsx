import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Building2,
  Camera,
  Compass,
  GraduationCap,
  MapPin,
  Quote,
  Settings,
  User,
  X,
} from 'lucide-react';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { useModalBackHandler } from '../lib/backNavigation';
import { openExternalUrl } from '../lib/nativeBridge';
import { isNativePlatform } from '../lib/nativePlatform';

interface LandingPageProps {
  onCreateAccount: () => void;
  onLogin: () => void;
  onExploreCommunity: () => void;
  onConnectGoogle?: () => Promise<void> | void;
  connectingGoogle?: boolean;
}

interface GalleryPhoto {
  id: string;
  src: string;
  alt: string;
  caption: string;
  tiltClass: string;
}

const HERO_ARCHITECTURE_IMG = '/images/icp-hero-campus.jpg';

const COLLEGE_GALLERY_PHOTOS: GalleryPhoto[] = [
  {
    id: 'icp-clock-tower',
    src: 'https://res.cloudinary.com/jnobnl9r/image/upload/v1795087575/images_1_gxj4ab.jpg',
    alt: 'Islamia College Peshawar historic main clock tower building',
    caption: 'Islamia College Peshawar — Historic Clock Tower',
    tiltClass: '-rotate-3 sm:-rotate-6 translate-y-1',
  },
  {
    id: 'icp-masjid',
    src: 'https://res.cloudinary.com/jnobnl9r/image/upload/v1795087575/images_2_w4lp7z.jpg',
    alt: 'Historic mosque at Islamia College Peshawar campus',
    caption: 'Islamia College Peshawar — Campus Mosque',
    tiltClass: 'rotate-2 sm:rotate-3 -translate-y-1',
  },
  {
    id: 'icp-arch-courtyard',
    src: 'https://res.cloudinary.com/jnobnl9r/image/upload/v1795087575/images_3_txsyn3.jpg',
    alt: 'Hostel courtyard view through stone arch at Islamia College Peshawar',
    caption: 'Islamia College Peshawar — Hostel Courtyard',
    tiltClass: '-rotate-2 sm:-rotate-3 translate-y-1',
  },
  {
    id: 'icp-panorama',
    src: 'https://res.cloudinary.com/jnobnl9r/image/upload/v1795087575/download_cgiblb.jpg',
    alt: 'Panoramic view of Islamia College Peshawar main campus building',
    caption: 'Islamia College Peshawar — Campus Panorama',
    tiltClass: 'rotate-3 sm:rotate-6',
  },
];

export function LandingPage({
  onCreateAccount,
  onLogin,
  onExploreCommunity,
  onConnectGoogle,
  connectingGoogle = false,
}: LandingPageProps) {
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [failedGalleryIds, setFailedGalleryIds] = useState<Record<string, boolean>>({});
  const [lightboxPhoto, setLightboxPhoto] = useState<GalleryPhoto | null>(null);
  const [showDeveloperModal, setShowDeveloperModal] = useState(false);
  const [devImgFailed, setDevImgFailed] = useState(false);

  useModalBackHandler(showDeveloperModal, () => setShowDeveloperModal(false));
  useModalBackHandler(Boolean(lightboxPhoto), () => setLightboxPhoto(null));

  useEffect(() => {
    if (!showDeveloperModal && !lightboxPhoto) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowDeveloperModal(false);
        setLightboxPhoto(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showDeveloperModal, lightboxPhoto]);

  return (
    <div className="min-h-screen bg-canvas text-ink overflow-x-clip pb-[env(safe-area-inset-bottom)]">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-canvas/90 backdrop-blur-xl border-b border-hairline pt-[env(safe-area-inset-top)]">
        <div className="max-w-6xl mx-auto px-3.5 sm:px-6 h-16 sm:h-18 flex items-center justify-between gap-2 sm:gap-4">
          <a href="#top" className="flex items-center gap-2.5 sm:gap-3 min-w-0 shrink">
            <img
              src="/icons/icon-192.png"
              alt="Hostel Friend"
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl object-cover border border-hairline-strong shrink-0 shadow-md"
            />
            <div className="min-w-0 leading-tight">
              <p className="font-display font-extrabold tracking-tight text-base sm:text-xl whitespace-nowrap">
                <span className="text-ink">Hostel </span>
                <span className="text-accent">Friend</span>
              </p>
              <p className="text-[10px] sm:text-xs text-ink-muted tracking-wide truncate">
                Connect • Share • Discover
              </p>
            </div>
          </a>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton variant="compact" />
            <button
              type="button"
              onClick={onCreateAccount}
              className="gold-gradient-btn px-3 sm:px-4.5 py-2 sm:py-2.5 rounded-full text-[11px] sm:text-sm font-bold flex items-center gap-1.5 shadow-[0_4px_18px_rgba(245,197,66,0.25)] transition-all active:scale-[0.98] whitespace-nowrap shrink-0"
            >
              <Settings className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span>Start Account Setup</span>
            </button>
          </div>
        </div>
      </header>

      {/* Cinematic Welcome Hero + Tilted 4-Photo Gallery + Action Buttons + Architectural Silhouette */}
      <section id="top" className="relative bg-canvas border-b border-hairline overflow-hidden">
        {/* Atmospheric Dusk Hero Backdrop */}
        <div className="relative pt-8 sm:pt-12 pb-6 sm:pb-8">
          <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
            {!heroImgFailed ? (
              <img
                src={HERO_ARCHITECTURE_IMG}
                alt="Islamia College Peshawar historic red-brick building at dusk"
                loading="eager"
                decoding="async"
                onError={() => setHeroImgFailed(true)}
                className="w-full h-full object-cover object-center scale-[1.03] brightness-[0.65] contrast-[1.08] saturate-[1.05]"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-b from-surface via-canvas-alt to-canvas" />
            )}
            {/* Dusk Sky & Vignette Overlays */}
            <div className="absolute inset-0 bg-gradient-to-b from-canvas/95 via-canvas/55 dark:via-canvas/35 to-canvas" />
            <div className="absolute inset-0 bg-gradient-to-r from-canvas/80 via-transparent to-canvas/80" />
            {/* Warm Golden Lighting Around the Architecture */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_58%,rgba(245,197,66,0.22),transparent_62%)]" />
          </div>

          <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 text-center">
            {/* Main Title */}
            <div className="pt-1 sm:pt-2">
              <p className="font-script text-4xl sm:text-5xl md:text-6xl text-accent leading-none drop-shadow-[0_2px_18px_rgba(245,197,66,0.4)]">
                Welcome to
              </p>
              <h1 className="mt-1 font-display font-extrabold tracking-tight text-4xl sm:text-6xl md:text-7xl leading-[1.04] dark:drop-shadow-[0_6px_24px_rgba(0,0,0,0.9)]">
                <span className="text-ink">Hostel </span>
                <span className="text-accent">Friend</span>
              </h1>
              {/* Curved Golden Underline Swoosh */}
              <div className="mt-1.5 flex justify-center" aria-hidden="true">
                <svg
                  viewBox="0 0 260 18"
                  className="w-44 sm:w-64 h-3.5 text-accent drop-shadow-[0_2px_10px_rgba(245,197,66,0.5)]"
                  fill="none"
                >
                  <path
                    d="M8 13C72 3 188 3 252 13"
                    stroke="currentColor"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>

            {/* Breathing Window Framing the Historic Red-Brick Building */}
            <div className="h-32 sm:h-48 md:h-56" aria-hidden="true" />

            {/* Welcome Message */}
            <div className="pt-2">
              <h2 className="font-display text-xl sm:text-2xl md:text-3xl font-bold tracking-tight dark:drop-shadow-[0_2px_12px_rgba(0,0,0,0.95)]">
                <span className="text-ink">Your Hostel. Your People. </span>
                <span className="text-accent">Your Memories.</span>
              </h2>
              <p className="mt-3 text-sm sm:text-base text-ink-2 dark:text-ink-muted max-w-lg mx-auto leading-relaxed dark:drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
                A place where hostel life becomes unforgettable.
                <br />
                Capture moments, share experiences and stay connected with your hostel friends.
              </p>
            </div>
          </div>
        </div>

        {/* Golden Light Divider + Graduation Cap */}
        <div className="relative z-10 max-w-3xl mx-auto px-4 pt-2 pb-6 flex items-center justify-center gap-4">
          <div className="h-[1.5px] flex-1 bg-gradient-to-r from-transparent via-accent/70 to-accent" />
          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-accent/25 blur-md" />
            <GraduationCap className="relative w-5 h-5 sm:w-6 sm:h-6 text-accent" />
          </div>
          <div className="h-[1.5px] flex-1 bg-gradient-to-l from-transparent via-accent/70 to-accent" />
        </div>

        {/* Four-Photo Tilted College & Hostel Gallery */}
        <div className="relative z-10 max-w-4xl mx-auto px-3 sm:px-6 pb-8 sm:pb-10">
          {/* Warm Golden Glow Behind Cards */}
          <div
            className="absolute inset-x-6 top-1/2 -translate-y-1/2 h-40 sm:h-52 bg-[radial-gradient(ellipse_at_center,rgba(245,197,66,0.24),rgba(217,155,25,0.08)_50%,transparent_75%)] pointer-events-none blur-xl"
            aria-hidden="true"
          />

          <div className="relative grid grid-cols-4 gap-1.5 sm:gap-4 items-center">
            {COLLEGE_GALLERY_PHOTOS.map((photo) => {
              const isFailed = Boolean(failedGalleryIds[photo.id]);
              return (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => !isFailed && setLightboxPhoto(photo)}
                  aria-label={photo.caption}
                  className={`hf-press hf-hover-scale group relative aspect-[3/4] sm:aspect-[4/5] w-full rounded-lg sm:rounded-xl overflow-hidden border-[2.5px] sm:border-[3.5px] border-white bg-surface shadow-lg dark:shadow-[0_14px_32px_rgba(0,0,0,0.85)] transition-transform duration-300 hover:z-20 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${photo.tiltClass}`}
                >
                  {isFailed ? (
                    <div className="w-full h-full flex flex-col items-center justify-center p-2 bg-surface text-center">
                      <Camera className="w-4 h-4 text-accent mb-1" />
                      <span className="text-[9px] sm:text-xs text-ink-muted leading-tight">
                        {photo.caption}
                      </span>
                    </div>
                  ) : (
                    <img
                      src={photo.src}
                      alt={photo.alt}
                      loading="eager"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={() =>
                        setFailedGalleryIds((prev) => ({ ...prev, [photo.id]: true }))
                      }
                      className="hf-group-scale w-full h-full object-cover object-center transition-transform duration-500"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Preserved Four Core Action Buttons */}
        <div className="relative z-10 max-w-md mx-auto px-4 sm:px-6 pb-8 space-y-3.5">
          {/* 1. Primary Button: Start Account Setup */}
          <button
            type="button"
            onClick={onCreateAccount}
            className="gold-gradient-btn w-full py-3.5 sm:py-4 px-6 rounded-full font-display font-bold text-base sm:text-lg flex items-center justify-center gap-2.5 shadow-[0_8px_28px_rgba(245,197,66,0.28)] active:scale-[0.99] transition-all"
          >
            <span>Start Account Setup</span>
            <ArrowRight className="w-5 h-5" />
          </button>

          {/* 2. Google Login Button: Connect with Google */}
          {onConnectGoogle && (
            <button
              type="button"
              disabled={connectingGoogle}
              onClick={onConnectGoogle}
              className="glass-btn w-full py-3.5 px-6 rounded-full border-accent/65 text-ink font-display font-semibold text-base flex items-center justify-center gap-3 disabled:opacity-50"
            >
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#EA4335"
                  d="M12 5c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.09 14.97 0 12 0 7.31 0 3.25 2.69 1.28 6.6l3.67 2.84C5.81 6.72 8.65 5 12 5z"
                />
                <path
                  fill="#4285F4"
                  d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58l3.7 2.87c2.16-1.99 3.72-4.92 3.72-8.69z"
                />
                <path
                  fill="#FBBC05"
                  d="M4.95 14.56A7.01 7.01 0 0 1 4.58 12c0-.89.16-1.75.44-2.56L1.35 6.6A11.96 11.96 0 0 0 0 12c0 1.94.46 3.77 1.28 5.4l3.67-2.84z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.7-2.87c-1.08.72-2.45 1.16-4.23 1.16-3.35 0-6.19-1.72-7.05-4.44L1.28 17.78C3.25 21.69 7.31 24 12 24z"
                />
              </svg>
              <span>{connectingGoogle ? 'Connecting...' : 'Connect with Google'}</span>
            </button>
          )}

          {/* 3 & 4. Explore Community + Sign In */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={onExploreCommunity}
              className="glass-btn flex-1 sm:flex-none px-5 py-3 rounded-full text-ink text-sm font-medium flex items-center justify-center gap-2.5 whitespace-nowrap"
            >
              <Compass className="w-4 h-4 text-accent shrink-0" />
              <span>Explore Community</span>
            </button>

            <button
              type="button"
              onClick={onLogin}
              className="hf-press px-5 py-3 text-sm sm:text-base font-semibold text-ink hover:text-accent whitespace-nowrap shrink-0"
            >
              Sign In
            </button>
          </div>

          {/* About Developer Trigger on Main Screen */}
          <div className="pt-2 flex justify-center">
            <button
              type="button"
              onClick={() => setShowDeveloperModal(true)}
              className="glass-btn px-5 py-2.5 rounded-full border-accent/45 text-accent text-xs sm:text-sm font-semibold inline-flex items-center gap-2"
            >
              <User className="w-4 h-4 shrink-0" />
              <span>About Developer</span>
            </button>
          </div>
        </div>

        {/* Golden Architectural Silhouette & Motto Footer Banner */}
        <div className="relative pt-2 pb-7 overflow-hidden">
          {!heroImgFailed && (
            <div className="relative max-w-4xl mx-auto h-24 sm:h-36 overflow-hidden pointer-events-none select-none">
              <img
                src={HERO_ARCHITECTURE_IMG}
                alt=""
                aria-hidden="true"
                loading="lazy"
                className="w-full h-full object-cover object-[50%_42%] opacity-35 sepia saturate-[2.4] hue-rotate-[-8deg] brightness-75 contrast-125"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/30 to-canvas" />
              <div className="absolute inset-0 bg-gradient-to-r from-canvas via-transparent to-canvas" />
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(245,197,66,0.18),transparent_68%)]" />
            </div>
          )}

          <div className="relative z-10 max-w-3xl mx-auto px-4 flex items-center justify-center gap-3 -mt-2">
            <span className="hidden sm:block h-[1px] w-12 bg-gradient-to-r from-transparent to-accent/60" />
            <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-[0.2em] text-accent text-center">
              BUILD FRIENDSHIPS • CREATE MEMORIES • GROW TOGETHER
            </p>
            <span className="hidden sm:block h-[1px] w-12 bg-gradient-to-l from-transparent to-accent/60" />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-5 sm:px-8 py-12 flex flex-col gap-6 text-xs text-ink-muted">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <img
              src="/icons/icon-192.png"
              alt="Hostel Friend"
              className="w-8 h-8 rounded-lg object-cover border border-hairline-strong"
            />
            <div>
              <p className="font-display font-semibold text-sm text-ink">
                Hostel <span className="text-accent">Friend</span>
              </p>
              <p className="mt-0.5 text-ink-muted">Connect • Share • Discover</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-6 text-ink-muted">
            <button type="button" onClick={onExploreCommunity} className="hover:text-accent">
              Explore
            </button>
            <button type="button" onClick={onCreateAccount} className="hover:text-accent">
              Create Account
            </button>
            <button type="button" onClick={onLogin} className="hover:text-accent">
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setShowDeveloperModal(true)}
              className="hover:text-accent"
            >
              About Developer
            </button>
          </div>
        </div>
      </footer>

      {/* About the Developer Modal */}
      {showDeveloperModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="developer-modal-title"
          onClick={() => setShowDeveloperModal(false)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3.5 sm:p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto glass-modal hf-modal-enter border-accent/40 rounded-3xl p-5 sm:p-8"
          >
            <div className="flex items-start justify-between gap-4 pb-5 mb-6 border-b border-hairline">
              <div>
                <p className="text-[11px] font-medium tracking-[0.14em] uppercase text-accent">
                  Founder &amp; Creator
                </p>
                <h2
                  id="developer-modal-title"
                  className="mt-1 font-display text-2xl sm:text-3xl font-bold tracking-tight text-ink"
                >
                  About the Developer
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowDeveloperModal(false)}
                aria-label="Close developer information"
                className="w-9 h-9 rounded-full bg-canvas border border-hairline-strong hover:border-accent text-ink flex items-center justify-center shrink-0 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
              {/* Developer Identity Card */}
              <div className="lg:col-span-5 flex flex-col gap-5">
                <div className="flex items-center gap-4">
                  <div className="relative w-24 h-28 sm:w-28 sm:h-32 rounded-2xl overflow-hidden border border-accent/45 bg-canvas shrink-0 shadow-lg">
                    {!devImgFailed ? (
                      <img
                        src="/images/developer-bait-ullah.png"
                        alt="Bait Ullah — Founder & Developer of Hostel Friend"
                        className="w-full h-full object-cover object-[50%_20%]"
                        onError={() => setDevImgFailed(true)}
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-surface-hover to-canvas text-accent">
                        <span className="font-display text-2xl font-bold tracking-tight">BU</span>
                        <span className="text-[10px] uppercase tracking-widest text-ink-muted mt-0.5">
                          Founder
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <h3 className="font-display text-xl sm:text-2xl font-bold text-ink">
                      Bait Ullah
                    </h3>
                    <p className="mt-1 text-xs font-semibold text-accent">
                      Founder &amp; Developer of Hostel Friend
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">Age: 19 years</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 pt-4 border-t border-hairline text-xs">
                  <div className="flex items-start gap-2.5 text-ink-muted">
                    <GraduationCap className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                    <div>
                      <p className="text-ink-muted text-[11px] uppercase tracking-wider">Education</p>
                      <p className="font-medium text-ink mt-0.5">
                        First Year (FSc) · Islamia College Peshawar
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5 text-ink-muted">
                    <Building2 className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                    <div>
                      <p className="text-ink-muted text-[11px] uppercase tracking-wider">Hostel</p>
                      <p className="font-medium text-ink mt-0.5">
                        HST Haji Sahib Turangzai Hostel, Islamia College Peshawar
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5 text-ink-muted">
                    <MapPin className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                    <div>
                      <p className="text-ink-muted text-[11px] uppercase tracking-wider">
                        Home District
                      </p>
                      <p className="font-medium text-ink mt-0.5">
                        District Mohmand, Khyber Pakhtunkhwa, Pakistan
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Biography, Vision, and WhatsApp Support */}
              <div className="lg:col-span-7 flex flex-col justify-between gap-5 lg:border-l lg:border-hairline lg:pl-8">
                <div className="space-y-3.5 text-sm text-ink-muted leading-relaxed">
                  <p>
                    Meet Bait Ullah, the founder and creator of Hostel Friend, a student-driven
                    social networking platform designed to bring hostel communities closer.
                  </p>
                  <p>
                    Originally from District Mohmand, Khyber Pakhtunkhwa, Bait Ullah is currently a
                    First Year student at the prestigious Islamia College Peshawar and resides at
                    HST Haji Sahib Turangzai Hostel.
                  </p>
                  <p>
                    Inspired by his own hostel experiences, friendships and student life, he
                    envisioned a digital platform where students can connect, share photographs and
                    videos, discover new friendships, communicate and preserve unforgettable
                    memories.
                  </p>
                  <p>
                    Hostel Friend represents his vision of connecting students beyond hostel rooms
                    and classrooms, building meaningful relationships and making every moment of
                    student life memorable.
                  </p>
                </div>

                {/* Developer Vision */}
                <div className="rounded-2xl border border-accent/25 bg-canvas/90 p-4">
                  <div className="flex items-start gap-3">
                    <Quote className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
                        Developer Vision
                      </p>
                      <p className="mt-1.5 text-sm font-medium text-ink leading-relaxed">
                        &ldquo;Connecting students, creating friendships, and preserving the
                        unforgettable memories of hostel life.&rdquo;
                      </p>
                    </div>
                  </div>
                </div>

                {/* WhatsApp Contact Block */}
                <div className="pt-3 border-t border-hairline flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <p className="text-xs sm:text-sm text-ink-muted leading-relaxed">
                    Have a question, need information, or want assistance with Hostel Friend? Contact
                    the developer directly on WhatsApp.
                  </p>
                  <a
                    href="https://wa.me/923439406862?text=Assalam-o-Alaikum%2C%20I%20need%20some%20information%20about%20Hostel%20Friend."
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      if (isNativePlatform()) {
                        e.preventDefault();
                        void openExternalUrl(
                          'https://wa.me/923439406862?text=Assalam-o-Alaikum%2C%20I%20need%20some%20information%20about%20Hostel%20Friend.'
                        );
                      }
                    }}
                    className="inline-flex items-center justify-center gap-2.5 w-full sm:w-auto px-5 py-3 rounded-xl bg-[#25D366] hover:bg-[#20BD5A] active:bg-[#1DA851] text-[#041209] font-semibold text-sm transition-colors whitespace-nowrap shrink-0 shadow-lg shadow-[#25D366]/15"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                      className="w-5 h-5 shrink-0"
                    >
                      <path d="M12.031 2c-5.516 0-9.969 4.453-9.969 9.969 0 1.766.469 3.484 1.344 5l-1.406 5.156 5.281-1.391c1.469.797 3.109 1.219 4.75 1.219 5.516 0 9.969-4.453 9.969-9.969S17.547 2 12.031 2zm5.813 14.125c-.25.703-1.438 1.344-2 1.422-.516.078-1.172.109-1.891-.125-.438-.141-.984-.328-1.688-.641-2.969-1.281-4.906-4.266-5.047-4.453-.141-.188-1.203-1.609-1.203-3.063 0-1.453.766-2.172 1.031-2.469.266-.297.578-.375.766-.375.188 0 .375.016.547.016.172 0 .406-.063.641.484.25.578.828 2.016.906 2.156.078.141.125.313.031.5-.094.188-.141.313-.297.484-.141.172-.313.391-.438.516-.141.141-.297.297-.125.594.172.297.766 1.266 1.641 2.047 1.125 1 2.078 1.313 2.375 1.469.297.141.469.125.641-.078.172-.203.75-.875.953-1.172.203-.297.406-.25.672-.141.266.094 1.719.813 2.016.953.297.141.484.219.563.344.078.125.078.734-.172 1.438z" />
                    </svg>
                    <span>Get Help on WhatsApp</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Optional Lightbox Preview Modal for Gallery Photos */}
      {lightboxPhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lightboxPhoto.caption}
          onClick={() => setLightboxPhoto(null)}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-2xl w-full glass-modal hf-modal-enter border-accent/40 rounded-2xl overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setLightboxPhoto(null)}
              aria-label="Close photo preview"
              className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-black/75 border border-white/20 text-white hover:border-accent flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
            <img
              src={lightboxPhoto.src}
              alt={lightboxPhoto.alt}
              referrerPolicy="no-referrer"
              className="w-full max-h-[75vh] object-contain bg-canvas"
            />
            <div className="p-4 border-t border-hairline flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-ink">{lightboxPhoto.caption}</p>
              <span className="text-[11px] text-accent uppercase tracking-wider shrink-0">
                Hostel Friend
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
