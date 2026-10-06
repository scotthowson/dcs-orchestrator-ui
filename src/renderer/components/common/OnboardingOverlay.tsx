// =============================================================================
// OnboardingOverlay — Multi-step onboarding with glassmorphism design
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Container,
  Rocket,
  Server,
  Sparkles,
  Puzzle,
  ArrowRight,
  ArrowLeft,
  X,
  ChevronRight,
} from 'lucide-react'
import { isWebMode } from '../../lib/env'
import ModalOverlay from './ModalOverlay'

const STORAGE_KEY = 'onboarding_complete'

interface StepDef {
  icon: React.ReactNode
  title: string
  description: string
  details: string[]
}

const webMode = isWebMode()

const steps: StepDef[] = [
  {
    icon: <Container size={40} strokeWidth={1.5} />,
    title: 'Welcome to DCS Orchestrator',
    description: webMode
      ? 'Your web-based control center for DCS Orchestrator. Monitor, deploy, and control your entire container infrastructure from one elegant interface.'
      : 'Your premium desktop companion for managing DCS Orchestrator servers. Monitor, deploy, and control your entire container infrastructure from one elegant interface.',
    details: [
      'Real-time container monitoring and health checks',
      'Manage multiple stacks with dependency ordering',
      'Dark glassmorphism UI with full keyboard shortcuts',
    ],
  },
  {
    icon: <Server size={40} strokeWidth={1.5} />,
    title: webMode ? 'Connected and ready' : 'Connect to your server',
    description: webMode
      ? 'Your DCS-UI is connected to the API server automatically. Manage server profiles and connection settings from the Settings page.'
      : 'Head to Settings and enter your DCS API server URL to get started. The default address is http://127.0.0.1:9876 for local servers.',
    details: [
      'Auto-reconnect with exponential backoff',
      'Connection health indicator in the status bar',
      'Switch between multiple server profiles',
    ],
  },
  {
    icon: <Rocket size={40} strokeWidth={1.5} />,
    title: 'Deploy your first stack',
    description:
      'Visit the Templates page to browse pre-configured stack templates. Pick one, customize it, and deploy — all without touching a terminal.',
    details: [
      'One-click stack deployment from templates',
      'Edit compose files and environment variables inline',
      'Start, stop, and restart stacks with progress tracking',
    ],
  },
  {
    icon: <Sparkles size={40} strokeWidth={1.5} />,
    title: "You're ready",
    description:
      'Explore the full suite of tools at your fingertips. From network visualization to automated maintenance, DCS Orchestrator has you covered.',
    details: [
      'Health checks, logs viewer, real-time compose linter, and system diagnostics',
      'Scheduled backups, cron job management, and a plugin ecosystem',
      'Command palette (Ctrl+K) for instant navigation',
    ],
  },
  {
    icon: <Puzzle size={40} strokeWidth={1.5} />,
    title: 'Plugins and compose linting',
    description:
      'Extend DCS with 14+ plugins for security auditing, deployment guards, network analysis, and more. The real-time compose linter validates your YAML with 24 rules — catching port conflicts, security issues, and missing health checks before deployment.',
    details: [
      'Install and manage plugins from the built-in plugin registry',
      'Compose linter runs automatically as you edit YAML files',
      'Security auditing, deployment guards, and network analysis plugins',
    ],
  },
]

export default function OnboardingOverlay() {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)

  // Don't auto-show — only show via 'show-onboarding' event
  // (triggered after setup wizard or from Settings "Show Onboarding" button)

  // Listen for re-show event (from Settings page)
  useEffect(() => {
    const handler = () => {
      setStep(0)
      setVisible(true)
    }
    window.addEventListener('show-onboarding', handler)
    return () => window.removeEventListener('show-onboarding', handler)
  }, [])

  const close = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true')
    setVisible(false)
  }, [])

  const next = useCallback(() => {
    if (step < steps.length - 1) setStep((s) => s + 1)
    else close()
  }, [step, close])

  const prev = useCallback(() => {
    if (step > 0) setStep((s) => s - 1)
  }, [step])

  // Keyboard navigation
  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [visible, close, next, prev])

  if (!visible) return null

  const current = steps[step]
  const isLast = step === steps.length - 1

  return createPortal(
    <ModalOverlay onClose={close} initialFocus="[data-autofocus]" className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={close}
      />

      {/* Card */}
      {/* (the card takes the focus itself: Enter is "next" here, which a focused button would answer as well) */}
      <div data-autofocus tabIndex={-1} className="relative w-full max-w-lg bg-slate-900/80 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl shadow-black/60 animate-scale-in overflow-hidden focus:outline-none">
        {/* Decorative gradient bar */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />

        {/* Skip / Close button */}
        <button
          onClick={close}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all z-10"
          title="Skip onboarding"
        >
          <X size={16} />
        </button>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-2 pt-6">
          {steps.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step
                  ? 'w-6 bg-emerald-400'
                  : i < step
                    ? 'w-1.5 bg-emerald-400/40'
                    : 'w-1.5 bg-white/10'
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="px-8 pt-8 pb-6">
          {/* Icon */}
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="absolute inset-0 rounded-2xl bg-emerald-500/15 blur-xl scale-150" />
              <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                {current.icon}
              </div>
            </div>
          </div>

          {/* Title */}
          <h2 className="text-xl font-bold text-center text-gradient mb-3">
            {current.title}
          </h2>

          {/* Description */}
          <p className="text-sm text-slate-400 text-center leading-relaxed mb-6">
            {current.description}
          </p>

          {/* Detail bullets */}
          <div className="space-y-2.5">
            {current.details.map((detail) => (
              <div
                key={detail}
                className="flex items-start gap-2.5 text-xs text-slate-300"
              >
                <ChevronRight
                  size={12}
                  className="text-emerald-400 mt-0.5 shrink-0"
                />
                <span>{detail}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer with navigation */}
        <div className="px-8 pb-6 flex items-center justify-between">
          {/* Previous */}
          <button
            onClick={prev}
            disabled={step === 0}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              step === 0
                ? 'text-slate-500 cursor-not-allowed'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            <ArrowLeft size={14} />
            Previous
          </button>

          {/* Skip + Next/Finish */}
          <div className="flex items-center gap-2">
            {!isLast && (
              <button
                onClick={close}
                className="px-3 py-2 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-300 transition-colors"
              >
                Skip
              </button>
            )}
            <button
              onClick={next}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20"
            >
              {isLast ? (
                <>
                  Get Started
                  <Sparkles size={14} />
                </>
              ) : (
                <>
                  Next
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>,
    document.body,
  )
}
