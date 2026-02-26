'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { apiRequest, getAccessToken, clearAuthData } from '@/lib/api'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useTheme } from '@/components/ThemeProvider'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'

// --- Types ---
interface Prompt {
    id: string
    template: string
    example: string | null
    description: string | null
    lineNumber: number
    promptType: 'NLP' | 'DEVELOPER'
}

interface Section {
    id: string
    name: string
    startLine: number
    endLine: number
    purpose: string
    prompts: Prompt[]
}

interface Page {
    id: string
    filePath: string
    componentName: string
    totalLines: number
    purpose: string
    rawContent: string | null
    promptFilePath: string | null
    category: 'FRONTEND' | 'BACKEND' | 'DATABASE'
    sections: Section[]
    stateVars: any[]
    functions: any[]
}

interface Project {
    id: string
    name: string
    path: string
    isActive: boolean
}

// --- Category config (high contrast) ---
const CATEGORIES = {
    FRONTEND: {
        label: 'Frontend',
        icon: '🎨',
        headerBg: '#14532d',
        headerText: '#86efac',
        lightBg: '#ecfdf5', // emerald-50
        lightText: '#065f46', // emerald-800
        badgeBg: '#166534',
        badgeText: '#bbf7d0',
        selectedBg: '#166534',
        selectedText: '#d1fae5',
        hoverBg: 'rgba(34, 197, 94, 0.08)',
    },
    BACKEND: {
        label: 'Backend',
        icon: '⚙️',
        headerBg: '#312e81',
        headerText: '#a5b4fc',
        lightBg: '#eef2ff', // indigo-50
        lightText: '#3730a3', // indigo-800
        badgeBg: '#3730a3',
        badgeText: '#c7d2fe',
        selectedBg: '#3730a3',
        selectedText: '#e0e7ff',
        hoverBg: 'rgba(129, 140, 248, 0.08)',
    },
    DATABASE: {
        label: 'Database',
        icon: '🗄️',
        headerBg: '#78350f',
        headerText: '#fcd34d',
        lightBg: '#fff7ed', // orange-50
        lightText: '#9a3412', // orange-800
        badgeBg: '#92400e',
        badgeText: '#fde68a',
        selectedBg: '#92400e',
        selectedText: '#fef3c7',
        hoverBg: 'rgba(251, 191, 36, 0.08)',
    },
} as const

type CategoryKey = keyof typeof CATEGORIES

// ==========================================
// Semantic folder label mapping
// ==========================================
const SEMANTIC_LABELS: Record<string, string> = {
    'app': 'Pages',
    'pages': 'Pages',
    'components': 'Components',
    'hooks': 'Hooks',
    'contexts': 'Contexts',
    'providers': 'Providers',
    'store': 'State',
    'redux': 'State',
    'styles': 'Styles',
    'lib': 'Utilities',
    'utils': 'Utilities',
    'helpers': 'Utilities',
    'routes': 'APIs',
    'api': 'APIs',
    'controllers': 'Controllers',
    'services': 'Services',
    'middleware': 'Middleware',
    'config': 'Config',
    'scripts': 'Scripts',
    'prisma': 'Schema',
    'migrations': 'Migrations',
    'seeds': 'Seeds',
    'seeders': 'Seeds',
    'models': 'Models',
    'entities': 'Models',
    'schemas': 'Schema',
    'db': 'Database',
    'templates': 'Templates',
    'llm': 'LLM',
    'src': '',
}

function getSemanticGroup(filePath: string): { group: string; display: string } {
    const parts = filePath.replace(/\\/g, '/').split('/')
    const fileName = parts[parts.length - 1]
    const displayName = fileName.replace(/\.(js|jsx|ts|tsx|css|scss|prisma|sql|txt)$/i, '')

    let group = 'Other'
    let subLabel = ''

    for (let i = parts.length - 2; i >= 0; i--) {
        const seg = parts[i].toLowerCase()
        if (SEMANTIC_LABELS[seg] !== undefined) {
            const mapped = SEMANTIC_LABELS[seg]
            if (mapped === '') continue
            group = mapped

            if ((mapped === 'Pages') && i < parts.length - 2) {
                const subParts = parts.slice(i + 1, parts.length - 1)
                subLabel = subParts.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' / ')
            }
            break
        }
    }

    let display = displayName.charAt(0).toUpperCase() + displayName.slice(1)
    if (subLabel) {
        display = `${subLabel} / ${display}`
    }

    return { group, display }
}

interface TreeGroup {
    label: string
    files: { page: Page; display: string }[]
}

function buildSemanticTree(pages: Page[]): TreeGroup[] {
    const groupMap: Record<string, { page: Page; display: string }[]> = {}

    for (const page of pages) {
        const { group, display } = getSemanticGroup(page.filePath)
        if (!groupMap[group]) groupMap[group] = []
        groupMap[group].push({ page, display })
    }

    const ORDER = ['Pages', 'Components', 'Hooks', 'Contexts', 'Styles', 'APIs', 'Controllers', 'Services', 'Middleware', 'Models', 'Schema', 'Migrations', 'Seeds', 'LLM', 'Templates', 'Utilities', 'Config', 'Scripts', 'State', 'Providers', 'Database']
    const sorted: TreeGroup[] = []
    for (const label of ORDER) {
        if (groupMap[label]) {
            sorted.push({ label, files: groupMap[label].sort((a, b) => a.display.localeCompare(b.display)) })
            delete groupMap[label]
        }
    }
    for (const [label, files] of Object.entries(groupMap)) {
        sorted.push({ label, files: files.sort((a, b) => a.display.localeCompare(b.display)) })
    }
    return sorted
}

// ==========================================
// NewDashboard Component
// ==========================================
export default function NewDashboard() {
    const router = useRouter()
    const { theme } = useTheme()
    const isDark = theme === 'dark'

    // Theme-aware color tokens - Stitch Palette in light mode
    const colors = {
        // Backgrounds
        pageBg: isDark ? '#0f172a' : '#fcfcfc',        // off-white/very light cream main bg
        headerBg: isDark ? '#1e293b' : '#ffffff',
        sidebarBg: isDark ? '#0f172a' : '#ffffff',        // pure white sidebar
        cardBg: isDark ? '#1e293b' : '#ffffff',
        inputBg: isDark ? '#1e293b' : '#ffffff',
        codeBg: isDark ? '#1e293b' : '#fffdeb',        // pale yellow/cream for code blocks
        codeInnerBg: isDark ? '#0f172a' : '#fffbeb',        // soft cream for inner blocks
        // Borders
        border: isDark ? '#1e293b' : '#f0f0f0',        // subtle soft border
        borderStrong: isDark ? '#334155' : '#e5e7eb',
        // Text — clean dark slate/grey for light mode
        textPrimary: isDark ? '#f1f5f9' : '#111827',
        textSecondary: isDark ? '#94a3b8' : '#4b5563',
        textMuted: isDark ? '#64748b' : '#6b7280',
        textFaint: isDark ? '#475569' : '#9ca3af',
        // Sidebar-specific
        sidebarText: isDark ? '#cbd5e1' : '#374151',        // dark grey inactive
        sidebarGroupLabel: isDark ? '#94a3b8' : '#111827',        // black headings
        sidebarGroupCount: isDark ? '#64748b' : '#6b7280',        // count text
        sidebarGroupHover: isDark ? 'rgba(255,255,255,0.04)' : '#f8f9fa',
    }

    const [pages, setPages] = useState<Page[]>([])
    const [project, setProject] = useState<Project | null>(null)
    const [selectedPage, setSelectedPage] = useState<Page | null>(null)
    const [loading, setLoading] = useState(true)
    const [syncing, setSyncing] = useState(false)
    const [syncMessage, setSyncMessage] = useState('')
    const [searchQuery, setSearchQuery] = useState('')
    const [sidebarWidth, setSidebarWidth] = useState(280)
    const [expandedCategories, setExpandedCategories] = useState<Set<CategoryKey>>(new Set(['FRONTEND', 'BACKEND', 'DATABASE']))
    // FIX: groups start expanded so folder labels are always visible
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
    // FIX: active category filter (null = show all)
    const [activeFilter, setActiveFilter] = useState<CategoryKey | null>(null)
    const [editMode, setEditMode] = useState(false)
    const [editContent, setEditContent] = useState('')
    // NLP prompt filter: null = all, or 'FRONTEND'|'BACKEND'|'DATABASE'
    const [promptFilter, setPromptFilter] = useState<CategoryKey | null>(null)
    // Per-prompt inline editing
    const [editingPromptId, setEditingPromptId] = useState<string | null>(null)
    const [editedPromptContent, setEditedPromptContent] = useState('')

    const isResizing = useRef(false)
    const editorRef = useRef<HTMLTextAreaElement>(null)

    // --- Resize ---
    const handleMouseDown = useCallback(() => {
        isResizing.current = true
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
    }, [])

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!isResizing.current) return
            setSidebarWidth(Math.max(220, Math.min(500, e.clientX)))
        }
        const onUp = () => {
            if (isResizing.current) {
                isResizing.current = false
                document.body.style.cursor = ''
                document.body.style.userSelect = ''
            }
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    }, [])

    // --- Init ---
    useEffect(() => { initDashboard() }, [])

    const initDashboard = async () => {
        try {
            const token = getAccessToken()
            if (!token) { router.push('/login'); return }
            const userStr = typeof window !== 'undefined' ? localStorage.getItem('user') : null
            const user = userStr ? JSON.parse(userStr) : null
            if (!user) { router.push('/login'); return }
            const projectsRes = await apiRequest(`/api/projects/user/${user.id}`)
            if (projectsRes.success && projectsRes.data?.projects) {
                const active = projectsRes.data.projects.find((p: Project) => p.isActive)
                if (active) { setProject(active); await loadPages(active.id) }
            }
        } catch (err) { console.error('Init failed:', err) }
        finally { setLoading(false) }
    }

    const loadPages = async (projectId: string): Promise<Page[]> => {
        try {
            const res = await apiRequest(`/api/pages?projectId=${projectId}`)
            if (res.success && res.data?.pages) {
                const loaded: Page[] = res.data.pages
                setPages(loaded)
                // FIX: auto-expand all groups so labels are visible on load
                const allGroupKeys = new Set<string>()
                for (const cat of Object.keys(CATEGORIES) as CategoryKey[]) {
                    const catPages = loaded.filter(p => p.category === cat)
                    const tree = buildSemanticTree(catPages)
                    tree.forEach(g => allGroupKeys.add(`${cat}:${g.label}`))
                }
                setExpandedGroups(allGroupKeys)
                return loaded
            }
        } catch (err) { console.error('Failed to load pages:', err) }
        return []
    }

    // --- Sync ---
    const handleSync = async () => {
        if (!project || syncing) return
        setSyncing(true)
        setSyncMessage('Scanning and classifying files...')
        try {
            const res = await fetch(`${API_URL}/api/seed`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: project.id })
            })
            const data = await res.json()
            if (data.success) {
                const s = data.summary
                setSyncMessage(`Synced ${s.total} files — Frontend: ${s.categories?.FRONTEND || 0} | Backend: ${s.categories?.BACKEND || 0} | Database: ${s.categories?.DATABASE || 0}`)
                const freshPages = await loadPages(project.id)
                // Refresh selectedPage if one is active
                if (selectedPage) {
                    const refreshed = freshPages.find((p: Page) => p.filePath === selectedPage.filePath)
                    if (refreshed) { setSelectedPage(refreshed); setEditContent(refreshed.rawContent || '') }
                }
            } else {
                setSyncMessage(`Sync failed: ${data.error}`)
            }
        } catch { setSyncMessage('Sync failed: Network error') }
        finally { setSyncing(false); setTimeout(() => setSyncMessage(''), 8000) }
    }

    const selectPage = (page: Page) => { setSelectedPage(page); setEditMode(false); setEditContent(page.rawContent || ''); setEditingPromptId(null); setPromptFilter(null) }

    const toggleCategory = (cat: CategoryKey) => {
        setExpandedCategories(prev => { const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n })
    }
    const toggleGroup = (key: string) => {
        setExpandedGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
    }

    // FIX: filter badge toggles active filter
    const toggleFilter = (cat: CategoryKey) => {
        setActiveFilter(prev => prev === cat ? null : cat)
    }

    const filterPages = (list: Page[]) => {
        if (!searchQuery) return list
        const q = searchQuery.toLowerCase()
        return list.filter(p => p.componentName.toLowerCase().includes(q) || p.filePath.toLowerCase().includes(q))
    }

    const categorized = {
        FRONTEND: filterPages(pages.filter(p => p.category === 'FRONTEND')),
        BACKEND: filterPages(pages.filter(p => p.category === 'BACKEND')),
        DATABASE: filterPages(pages.filter(p => p.category === 'DATABASE')),
    }

    // Which categories to show in the sidebar tree (respects active filter)
    const visibleCategories = (Object.keys(CATEGORIES) as CategoryKey[]).filter(
        cat => activeFilter === null || activeFilter === cat
    )

    // --- Save ---
    const handleSave = async () => {
        if (!selectedPage || syncing) return
        setSyncing(true)
        setSyncMessage('Saving prompt to source file...')
        try {
            const res = await apiRequest(`/api/save`, {
                method: 'POST',
                body: { pageId: selectedPage.id, content: editContent, projectId: project?.id }
            })
            if (res.success) {
                setSyncMessage('✅ Saved successfully to source file!')
                setTimeout(() => setSyncMessage(''), 4000)
                setEditMode(false)
                // Refresh pages so the UI shows the saved content
                if (project) {
                    const freshPages = await loadPages(project.id)
                    const refreshed = freshPages.find((p: Page) => p.filePath === selectedPage.filePath)
                    if (refreshed) { setSelectedPage(refreshed); setEditContent(refreshed.rawContent || '') }
                }
            } else {
                setSyncMessage(`❌ Save failed: ${res.error || 'Unknown error'}`)
                setTimeout(() => setSyncMessage(''), 6000)
            }
        } catch {
            setSyncMessage('❌ Save failed: Network error')
            setTimeout(() => setSyncMessage(''), 6000)
        } finally {
            setSyncing(false)
        }
    }

    const handleLogout = () => { clearAuthData(); router.push('/login') }

    // --- Loading ---
    if (loading) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.pageBg }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ width: 48, height: 48, borderTopWidth: 4, borderTopStyle: 'solid', borderTopColor: '#6366f1', borderRightWidth: 4, borderRightStyle: 'solid', borderRightColor: colors.borderStrong, borderBottomWidth: 4, borderBottomStyle: 'solid', borderBottomColor: colors.borderStrong, borderLeftWidth: 4, borderLeftStyle: 'solid', borderLeftColor: colors.borderStrong, borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
                    <p style={{ color: colors.textSecondary, fontSize: 14 }}>Loading dashboard...</p>
                </div>
            </div>
        )
    }

    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: colors.pageBg, color: colors.textPrimary, overflow: 'hidden', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>

            {/* ===== HEADER ===== */}
            <header style={{ flexShrink: 0, height: 48, borderBottom: `1px solid ${colors.border}`, background: colors.headerBg, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12 }}>
                <button onClick={() => router.push('/home')} style={{ display: 'flex', alignItems: 'center', gap: 4, color: colors.textSecondary, fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    Projects
                </button>
                <div style={{ width: 1, height: 20, background: colors.borderStrong }} />
                <h1 style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary, margin: 0 }}>{project?.name || 'No Project'}</h1>
                <div style={{ flex: 1 }} />
                <button
                    onClick={handleSync}
                    disabled={syncing}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500, border: `1px solid ${colors.borderStrong}`, background: colors.cardBg, color: syncing ? colors.textMuted : colors.textPrimary, cursor: syncing ? 'wait' : 'pointer' }}
                >
                    <svg style={{ width: 14, height: 14, ...(syncing ? { animation: 'spin 1s linear infinite' } : {}) }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {syncing ? 'Syncing...' : 'Sync'}
                </button>
                <ThemeToggle />
                <button onClick={handleLogout} style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textMuted, padding: 0 }} title="Logout">
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                </button>
            </header>

            {/* Sync banner */}
            {syncMessage && (
                <div style={{ flexShrink: 0, padding: '6px 16px', fontSize: 12, textAlign: 'center', fontWeight: 500, background: syncMessage.includes('failed') || syncMessage.includes('Failed') ? '#450a0a' : '#022c22', color: syncMessage.includes('failed') || syncMessage.includes('Failed') ? '#fca5a5' : '#86efac', borderBottom: `1px solid ${colors.border}` }}>
                    {syncMessage}
                </div>
            )}

            {/* ===== MAIN ===== */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

                {/* ===== SIDEBAR ===== */}
                <aside style={{ flexShrink: 0, width: sidebarWidth, borderRight: `1px solid ${colors.border}`, background: colors.sidebarBg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

                    {/* Search */}
                    <div style={{ padding: 12, borderBottom: `1px solid ${colors.border}` }}>
                        <input
                            type="text"
                            placeholder="Search files..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            style={{
                                width: '100%', padding: '8px 12px',
                                background: isDark ? '#1e293b' : '#fffdf4',
                                border: `1px solid ${isDark ? '#334155' : '#FFD6A5'}`,
                                borderRadius: 8, fontSize: 13,
                                color: colors.textPrimary,
                                outline: 'none',
                                boxSizing: 'border-box',
                            }}
                        />
                    </div>

                    {/* Stats / Filter Badges */}
                    <div style={{ display: 'flex', gap: 8, padding: '12px 12px', borderBottom: `1px solid ${colors.border}` }}>
                        <button
                            onClick={() => toggleFilter('FRONTEND')}
                            title={activeFilter === 'FRONTEND' ? `Clear filter` : `Filter: Frontend`}
                            style={{
                                flex: 1, textAlign: 'center', padding: '10px 0',
                                borderRadius: 6, background: '#1c5e20', color: '#ffffff',
                                border: activeFilter === 'FRONTEND' ? `2px solid #fff` : '2px solid transparent',
                                cursor: 'pointer', outline: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                boxShadow: activeFilter === 'FRONTEND' ? '0 0 0 2px #1c5e20' : 'none'
                            }}
                        >
                            <span>🎨</span> <span style={{ fontSize: 12, fontWeight: 700 }}>{categorized['FRONTEND']?.length || 0}</span>
                        </button>
                        <button
                            onClick={() => toggleFilter('BACKEND')}
                            title={activeFilter === 'BACKEND' ? `Clear filter` : `Filter: Backend`}
                            style={{
                                flex: 1, textAlign: 'center', padding: '10px 0',
                                borderRadius: 6, background: '#312e81', color: '#ffffff',
                                border: activeFilter === 'BACKEND' ? `2px solid #fff` : '2px solid transparent',
                                cursor: 'pointer', outline: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                boxShadow: activeFilter === 'BACKEND' ? '0 0 0 2px #312e81' : 'none'
                            }}
                        >
                            <span>⚙️</span> <span style={{ fontSize: 12, fontWeight: 700 }}>{categorized['BACKEND']?.length || 0}</span>
                        </button>
                        <button
                            onClick={() => toggleFilter('DATABASE')}
                            title={activeFilter === 'DATABASE' ? `Clear filter` : `Filter: Database`}
                            style={{
                                flex: 1, textAlign: 'center', padding: '10px 0',
                                borderRadius: 6, background: '#78350f', color: '#ffffff',
                                border: activeFilter === 'DATABASE' ? `2px solid #fff` : '2px solid transparent',
                                cursor: 'pointer', outline: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                boxShadow: activeFilter === 'DATABASE' ? '0 0 0 2px #78350f' : 'none'
                            }}
                        >
                            <span>🗄️</span> <span style={{ fontSize: 12, fontWeight: 700 }}>{categorized['DATABASE']?.length || 0}</span>
                        </button>
                    </div>

                    {/* Active filter indicator */}
                    {activeFilter && (
                        <div style={{ padding: '4px 10px', fontSize: 11, color: CATEGORIES[activeFilter].headerText, background: CATEGORIES[activeFilter].headerBg, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span>Showing: {CATEGORIES[activeFilter].label} only</span>
                            <button onClick={() => setActiveFilter(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 11, padding: 0, textDecoration: 'underline' }}>Clear</button>
                        </div>
                    )}

                    {/* Tree */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
                        {/* Root folders */}
                        <div className="space-y-0.5">
                            <div
                                onClick={() => toggleCategory('FRONTEND')}
                                className="flex items-center justify-between px-4 py-2.5 cursor-pointer group rounded-lg transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    <span className={`w-5 h-5 rounded flex items-center justify-center transition-colors text-white ${expandedCategories.has('FRONTEND') ? 'bg-[#1c5e20]' : 'bg-[#1c5e20]'}`}>
                                        <svg className={`w-3.5 h-3.5 transition-transform ${expandedCategories.has('FRONTEND') ? 'rotate-90' : 'rotate-0'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </span>
                                    <span className="font-bold text-[13px] tracking-wide uppercase" style={{ color: isDark ? '#ffffff' : '#063013' }}>
                                        Frontend
                                    </span>
                                </div>
                                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full" style={{ background: '#1c5e20', color: '#ffffff' }}>
                                    {categorized.FRONTEND.length}
                                </span>
                            </div>
                            <div style={{
                                display: 'grid',
                                gridTemplateRows: expandedCategories.has('FRONTEND') ? '1fr' : '0fr',
                                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                            }}>
                                <div className="overflow-hidden">
                                    <div className="pl-3 mt-1 space-y-px">
                                        {buildSemanticTree(categorized.FRONTEND).map(group => {
                                            const gKey = `FRONTEND:${group.label}`
                                            const gOpen = expandedGroups.has(gKey)
                                            return (
                                                <div key={gKey}>
                                                    <button
                                                        onClick={() => toggleGroup(gKey)}
                                                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px 5px 24px', fontSize: 12, fontWeight: 600, color: colors.sidebarGroupLabel, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                                                        onMouseEnter={e => (e.currentTarget.style.background = colors.sidebarGroupHover)}
                                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                                    >
                                                        <span style={{ fontSize: 9, transition: 'transform 0.15s', transform: gOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block', color: colors.textMuted }}>▶</span>
                                                        <span style={{ color: colors.textSecondary }}>📁</span>
                                                        <span>{group.label}</span>
                                                        <span style={{ marginLeft: 'auto', fontSize: 10, color: colors.sidebarGroupCount, fontWeight: 600 }}>{group.files.length}</span>
                                                    </button>
                                                    {gOpen && group.files.map(({ page, display }) => {
                                                        const isSel = selectedPage?.id === page.id
                                                        const hasPrompt = !!page.promptFilePath
                                                        const ext = page.filePath.split('.').pop()?.toLowerCase() || ''
                                                        const icon = ext === 'tsx' || ext === 'jsx' ? '⚛️' : ext === 'ts' || ext === 'js' ? '📜' : ext === 'css' ? '🎨' : ext === 'prisma' ? '💎' : ext === 'txt' ? '📝' : '📄'

                                                        return (
                                                            <button
                                                                key={page.id}
                                                                onClick={() => selectPage(page)}
                                                                style={{
                                                                    width: '100%', display: 'flex', alignItems: 'center', gap: 5,
                                                                    padding: '4px 12px 4px 40px', fontSize: 12, border: 'none', cursor: 'pointer', textAlign: 'left',
                                                                    background: isSel ? '#185A2D' : 'transparent',
                                                                    color: isSel ? '#ffffff' : colors.sidebarText,
                                                                    fontWeight: isSel ? 600 : 400,
                                                                    boxSizing: 'border-box',
                                                                    borderLeft: isSel ? '3px solid #3ec162' : '3px solid transparent',
                                                                }}
                                                                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.04)' : '#f3f4f6' }}
                                                                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}
                                                            >
                                                                <span style={{ flexShrink: 0 }}>{icon}</span>
                                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{display}</span>
                                                                {hasPrompt && <span style={{ marginLeft: 'auto', flexShrink: 0, width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} title="Has prompt" />}
                                                            </button>
                                                        )
                                                    })}
                                                    {gOpen && group.files.length === 0 && (
                                                        <p style={{ padding: '8px 24px', fontSize: 11, color: colors.textFaint, fontStyle: 'italic' }}>No files</p>
                                                    )}
                                                </div>
                                            )
                                        })}
                                        {expandedCategories.has('FRONTEND') && categorized.FRONTEND.length === 0 && (
                                            <p style={{ padding: '8px 24px', fontSize: 11, color: colors.textFaint, fontStyle: 'italic' }}>No files</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-0.5">
                            <div
                                onClick={() => toggleCategory('BACKEND')}
                                className="flex items-center justify-between px-3 py-2 cursor-pointer group rounded-lg transition-colors"
                                style={{
                                    background: expandedCategories.has('BACKEND')
                                        ? (isDark ? 'rgba(255,255,255,0.05)' : '#ffffff')
                                        : 'transparent'
                                }}
                            >
                                <div className="flex items-center gap-2">
                                    <span className={`w-4 h-4 rounded flex items-center justify-center transition-colors ${expandedCategories.has('BACKEND') ? 'bg-blue-800 text-blue-100' : 'bg-blue-100 text-blue-700'}`}>
                                        <svg className={`w-3 h-3 transition-transform ${expandedCategories.has('BACKEND') ? 'rotate-90' : 'rotate(0deg)'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </span>
                                    <span className="font-semibold text-[13px] tracking-wide uppercase" style={{ color: isDark ? '#ffffff' : '#111827' }}>
                                        Backend
                                    </span>
                                </div>
                                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#312e81', color: '#ffffff' }}>
                                    {categorized.BACKEND.length}
                                </span>
                            </div>
                            <div style={{
                                display: 'grid',
                                gridTemplateRows: expandedCategories.has('BACKEND') ? '1fr' : '0fr',
                                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                            }}>
                                <div className="overflow-hidden">
                                    <div className="pl-3 mt-1 space-y-px">
                                        {buildSemanticTree(categorized.BACKEND).map(group => {
                                            const gKey = `BACKEND:${group.label}`
                                            const gOpen = expandedGroups.has(gKey)
                                            return (
                                                <div key={gKey}>
                                                    <button
                                                        onClick={() => toggleGroup(gKey)}
                                                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px 5px 24px', fontSize: 12, fontWeight: 600, color: colors.sidebarGroupLabel, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                                                        onMouseEnter={e => (e.currentTarget.style.background = colors.sidebarGroupHover)}
                                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                                    >
                                                        <span style={{ fontSize: 9, transition: 'transform 0.15s', transform: gOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block', color: colors.textMuted }}>▶</span>
                                                        <span style={{ color: colors.textSecondary }}>📁</span>
                                                        <span>{group.label}</span>
                                                        <span style={{ marginLeft: 'auto', fontSize: 10, color: colors.sidebarGroupCount, fontWeight: 600 }}>{group.files.length}</span>
                                                    </button>
                                                    {gOpen && group.files.map(({ page, display }) => {
                                                        const isSel = selectedPage?.id === page.id
                                                        const hasPrompt = !!page.promptFilePath
                                                        const ext = page.filePath.split('.').pop()?.toLowerCase() || ''
                                                        const icon = ext === 'tsx' || ext === 'jsx' ? '⚛️' : ext === 'ts' || ext === 'js' ? '📜' : ext === 'css' ? '🎨' : ext === 'prisma' ? '💎' : ext === 'txt' ? '📝' : '📄'

                                                        return (
                                                            <button
                                                                key={page.id}
                                                                onClick={() => selectPage(page)}
                                                                style={{
                                                                    width: '100%', display: 'flex', alignItems: 'center', gap: 5,
                                                                    padding: '4px 12px 4px 40px', fontSize: 12, border: 'none', cursor: 'pointer', textAlign: 'left',
                                                                    background: isSel ? '#185A2D' : 'transparent',
                                                                    color: isSel ? '#ffffff' : colors.sidebarText,
                                                                    fontWeight: isSel ? 600 : 400,
                                                                    boxSizing: 'border-box',
                                                                    borderLeft: isSel ? '3px solid #3ec162' : '3px solid transparent',
                                                                }}
                                                                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.04)' : '#f3f4f6' }}
                                                                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}
                                                            >
                                                                <span style={{ flexShrink: 0 }}>{icon}</span>
                                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{display}</span>
                                                                {hasPrompt && <span style={{ marginLeft: 'auto', flexShrink: 0, width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} title="Has prompt" />}
                                                            </button>
                                                        )
                                                    })}
                                                    {gOpen && group.files.length === 0 && (
                                                        <p style={{ padding: '8px 24px', fontSize: 11, color: colors.textFaint, fontStyle: 'italic' }}>No files</p>
                                                    )}
                                                </div>
                                            )
                                        })}
                                        {expandedCategories.has('BACKEND') && categorized.BACKEND.length === 0 && (
                                            <p style={{ padding: '8px 24px', fontSize: 11, color: colors.textFaint, fontStyle: 'italic' }}>No files</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-0.5">
                            <div
                                onClick={() => toggleCategory('DATABASE')}
                                className="flex items-center justify-between px-3 py-2 cursor-pointer group rounded-lg transition-colors"
                                style={{
                                    background: expandedCategories.has('DATABASE')
                                        ? (isDark ? 'rgba(255,255,255,0.05)' : '#ffffff')
                                        : 'transparent'
                                }}
                            >
                                <div className="flex items-center gap-2">
                                    <span className={`w-4 h-4 rounded flex items-center justify-center transition-colors ${expandedCategories.has('DATABASE') ? 'bg-orange-800 text-orange-100' : 'bg-orange-100 text-orange-700'}`}>
                                        <svg className={`w-3 h-3 transition-transform ${expandedCategories.has('DATABASE') ? 'rotate-90' : 'rotate(0deg)'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </span>
                                    <span className="font-semibold text-[13px] tracking-wide uppercase" style={{ color: isDark ? '#ffffff' : '#111827' }}>
                                        Database
                                    </span>
                                </div>
                                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#78350f', color: '#ffffff' }}>
                                    {categorized.DATABASE.length}
                                </span>
                            </div>
                            <div style={{
                                display: 'grid',
                                gridTemplateRows: expandedCategories.has('DATABASE') ? '1fr' : '0fr',
                                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                            }}>
                                <div className="overflow-hidden">
                                    <div className="pl-3 mt-1 space-y-px">
                                        {buildSemanticTree(categorized.DATABASE).map(group => {
                                            const gKey = `DATABASE:${group.label}`
                                            const gOpen = expandedGroups.has(gKey)
                                            return (
                                                <div key={gKey}>
                                                    <button
                                                        onClick={() => toggleGroup(gKey)}
                                                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px 5px 24px', fontSize: 12, fontWeight: 600, color: colors.sidebarGroupLabel, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                                                        onMouseEnter={e => (e.currentTarget.style.background = colors.sidebarGroupHover)}
                                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                                    >
                                                        <span style={{ fontSize: 9, transition: 'transform 0.15s', transform: gOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block', color: colors.textMuted }}>▶</span>
                                                        <span style={{ color: colors.textSecondary }}>📁</span>
                                                        <span>{group.label}</span>
                                                        <span style={{ marginLeft: 'auto', fontSize: 10, color: colors.sidebarGroupCount, fontWeight: 600 }}>{group.files.length}</span>
                                                    </button>
                                                    {gOpen && group.files.map(({ page, display }) => {
                                                        const isSel = selectedPage?.id === page.id
                                                        const hasPrompt = !!page.promptFilePath
                                                        const ext = page.filePath.split('.').pop()?.toLowerCase() || ''
                                                        const icon = ext === 'tsx' || ext === 'jsx' ? '⚛️' : ext === 'ts' || ext === 'js' ? '📜' : ext === 'css' ? '🎨' : ext === 'prisma' ? '💎' : ext === 'txt' ? '📝' : '📄'

                                                        return (
                                                            <button
                                                                key={page.id}
                                                                onClick={() => selectPage(page)}
                                                                style={{
                                                                    width: '100%', display: 'flex', alignItems: 'center', gap: 5,
                                                                    padding: '4px 12px 4px 40px', fontSize: 12, border: 'none', cursor: 'pointer', textAlign: 'left',
                                                                    background: isSel ? '#185A2D' : 'transparent',
                                                                    color: isSel ? '#ffffff' : colors.sidebarText,
                                                                    fontWeight: isSel ? 600 : 400,
                                                                    boxSizing: 'border-box',
                                                                    borderLeft: isSel ? '3px solid #3ec162' : '3px solid transparent',
                                                                }}
                                                                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.04)' : '#f3f4f6' }}
                                                                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}
                                                            >
                                                                <span style={{ flexShrink: 0 }}>{icon}</span>
                                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{display}</span>
                                                                {hasPrompt && <span style={{ marginLeft: 'auto', flexShrink: 0, width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} title="Has prompt" />}
                                                            </button>
                                                        )
                                                    })}
                                                    {gOpen && group.files.length === 0 && (
                                                        <p style={{ padding: '8px 24px', fontSize: 11, color: colors.textFaint, fontStyle: 'italic' }}>No files</p>
                                                    )}
                                                </div>
                                            )
                                        })}
                                        {expandedCategories.has('DATABASE') && categorized.DATABASE.length === 0 && (
                                            <p style={{ padding: '8px 24px', fontSize: 11, color: colors.textFaint, fontStyle: 'italic' }}>No files</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </aside>

                {/* Resize handle */}
                <div onMouseDown={handleMouseDown} style={{ flexShrink: 0, width: 3, cursor: 'col-resize', background: colors.border }}
                    onMouseEnter={e => e.currentTarget.style.background = '#3b82f6'}
                    onMouseLeave={e => e.currentTarget.style.background = colors.border}
                />

                {/* ===== MAIN PANEL ===== */}
                <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: colors.pageBg }}>
                    {selectedPage ? (
                        <>
                            {/* File header */}
                            <div style={{ flexShrink: 0, borderBottom: `1px solid ${colors.border}`, background: colors.headerBg, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: CATEGORIES[selectedPage.category]?.headerBg, color: CATEGORIES[selectedPage.category]?.headerText }}>
                                    {CATEGORIES[selectedPage.category]?.icon} {CATEGORIES[selectedPage.category]?.label}
                                </span>
                                <span style={{ color: colors.textMuted }}>/</span>
                                <span style={{ color: colors.textPrimary, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedPage.componentName}</span>
                                <span style={{ color: colors.textFaint, fontSize: 11 }}>({selectedPage.filePath})</span>
                                <div style={{ flex: 1 }} />
                                <span style={{ fontSize: 11, color: colors.textSecondary }}>{selectedPage.totalLines} lines</span>
                            </div>

                            {/* ===== FILTER TOGGLE BAR ===== */}
                            <div style={{ flexShrink: 0, borderBottom: `1px solid ${colors.border}`, background: isDark ? '#111827' : '#f9fafb', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4 }}>Filter:</span>
                                {(['FRONTEND', 'BACKEND', 'DATABASE'] as CategoryKey[]).map(cat => {
                                    const cfg = CATEGORIES[cat]
                                    const isActive = promptFilter === cat
                                    return (
                                        <button
                                            key={cat}
                                            onClick={() => setPromptFilter(prev => prev === cat ? null : cat)}
                                            style={{
                                                padding: '5px 14px',
                                                borderRadius: 20,
                                                fontSize: 12,
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                border: isActive ? `2px solid ${cfg.headerBg}` : `1.5px solid ${colors.borderStrong}`,
                                                background: isActive ? cfg.headerBg : (isDark ? '#1e293b' : '#ffffff'),
                                                color: isActive ? cfg.headerText : colors.textSecondary,
                                                transition: 'all 0.15s ease',
                                                outline: 'none',
                                            }}
                                        >
                                            {cfg.icon} {cfg.label}
                                        </button>
                                    )
                                })}
                                {promptFilter && (
                                    <button
                                        onClick={() => setPromptFilter(null)}
                                        style={{ marginLeft: 4, padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500, cursor: 'pointer', border: `1px solid ${colors.borderStrong}`, background: 'transparent', color: colors.textMuted, outline: 'none' }}
                                    >
                                        ✕ Clear
                                    </button>
                                )}
                                <div style={{ flex: 1 }} />
                                {/* Re-generate Button */}
                                <button
                                    onClick={async () => {
                                        if (!selectedPage || syncing) return
                                        const currentFilePath = selectedPage.filePath
                                        setSyncing(true)
                                        setSyncMessage('Generating prompts from template...')
                                        // Clear old prompt immediately so stale content is gone
                                        setSelectedPage(prev => prev ? { ...prev, rawContent: null, sections: [] } : prev)
                                        setEditContent('')
                                        setEditMode(false)
                                        setPromptFilter(null)
                                        try {
                                            const res = await fetch(`${API_URL}/api/generate-prompts`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ projectId: project?.id, filePath: currentFilePath })
                                            })
                                            const data = await res.json()
                                            if (data.success) {
                                                setSyncMessage(`Prompts re-generated successfully! (${data.elapsed})`)
                                                // Directly fetch fresh pages and find the regenerated one
                                                if (project) {
                                                    const freshPages = await loadPages(project.id)
                                                    const regeneratedPage = freshPages.find((p: Page) => p.filePath === currentFilePath)
                                                    if (regeneratedPage) {
                                                        setSelectedPage(regeneratedPage)
                                                        setEditContent(regeneratedPage.rawContent || '')
                                                    }
                                                }
                                            } else {
                                                setSyncMessage(`Re-generate failed: ${data.error}`)
                                            }
                                        } catch { setSyncMessage('Re-generate failed: Network error') }
                                        finally { setSyncing(false); setTimeout(() => setSyncMessage(''), 8000) }
                                    }}
                                    disabled={syncing}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 6,
                                        padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                                        cursor: syncing ? 'wait' : 'pointer',
                                        border: `1.5px solid ${isDark ? '#6366f1' : '#4f46e5'}`,
                                        background: isDark ? '#312e81' : '#eef2ff',
                                        color: isDark ? '#a5b4fc' : '#4338ca',
                                        transition: 'all 0.15s ease',
                                        outline: 'none',
                                    }}
                                >
                                    <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={syncing ? { animation: 'spin 1s linear infinite' } : {}}>
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                                    </svg>
                                    {syncing ? 'Generating...' : 'Re-generate'}
                                </button>
                            </div>

                            {/* Content */}
                            <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
                                {(() => {
                                    // Get the full prompt text
                                    const fullContent = editMode ? editContent : (selectedPage.rawContent || '')

                                    // Apply focused filter: extract content between ### Category markers
                                    const applyFocusedFilter = (content: string, filter: CategoryKey): string => {
                                        if (!content) return ''
                                        const contentLines = content.split('\n')
                                        const filteredLines: string[] = []
                                        let insideMatchingBlock = false

                                        for (const line of contentLines) {
                                            const lowerLine = line.trim().toLowerCase()
                                            const isH3Heading = lowerLine.startsWith('### ') && !lowerLine.startsWith('#### ')

                                            if (isH3Heading) {
                                                if (lowerLine.startsWith('### frontend')) {
                                                    insideMatchingBlock = filter === 'FRONTEND'
                                                } else if (lowerLine.startsWith('### backend')) {
                                                    insideMatchingBlock = filter === 'BACKEND'
                                                } else if (lowerLine.startsWith('### database')) {
                                                    insideMatchingBlock = filter === 'DATABASE'
                                                } else {
                                                    insideMatchingBlock = false
                                                }
                                            }

                                            if (lowerLine.startsWith('===') && insideMatchingBlock && filteredLines.length > 0) {
                                                insideMatchingBlock = false
                                            }

                                            if (insideMatchingBlock) {
                                                filteredLines.push(line)
                                            }
                                        }

                                        return filteredLines.join('\n')
                                    }

                                    const displayContent = promptFilter
                                        ? applyFocusedFilter(fullContent, promptFilter)
                                        : fullContent

                                    return (
                                        <>
                                            {displayContent ? (
                                                <div>
                                                    {/* Action bar */}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                                                        {promptFilter && (
                                                            <span style={{ fontSize: 11, fontWeight: 600, color: CATEGORIES[promptFilter].headerText, background: CATEGORIES[promptFilter].headerBg, padding: '2px 10px', borderRadius: 10 }}>
                                                                {CATEGORIES[promptFilter].icon} {CATEGORIES[promptFilter].label} Prompts
                                                            </span>
                                                        )}
                                                        <div style={{ flex: 1 }} />
                                                        {editMode ? (
                                                            <>
                                                                <button
                                                                    onClick={handleSave}
                                                                    disabled={syncing}
                                                                    style={{ padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: syncing ? 'wait' : 'pointer', background: '#15803d', color: '#d1fae5', border: '1px solid #166534', outline: 'none', display: 'flex', alignItems: 'center', gap: 4, opacity: syncing ? 0.6 : 1 }}
                                                                >
                                                                    {syncing ? '⏳ Saving...' : '✓ Save'}
                                                                </button>
                                                                <button
                                                                    onClick={() => { setEditMode(false); setEditContent(selectedPage.rawContent || '') }}
                                                                    style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', background: 'transparent', color: colors.textMuted, border: `1px solid ${colors.borderStrong}`, outline: 'none' }}
                                                                >
                                                                    Cancel
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <button
                                                                onClick={() => { setEditMode(true); setEditContent(selectedPage.rawContent || ''); setPromptFilter(null) }}
                                                                style={{ padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: isDark ? '#1e293b' : '#f1f5f9', color: colors.textPrimary, border: `1px solid ${colors.borderStrong}`, outline: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                                                            >
                                                                ✏️ Edit Prompt
                                                            </button>
                                                        )}
                                                    </div>

                                                    {/* Content display */}
                                                    {editMode ? (
                                                        <textarea
                                                            ref={editorRef}
                                                            autoFocus
                                                            value={editContent}
                                                            onChange={e => setEditContent(e.target.value)}
                                                            spellCheck={false}
                                                            style={{
                                                                width: '100%',
                                                                minHeight: 'calc(100vh - 260px)',
                                                                background: isDark ? '#0f172a' : '#fafafa',
                                                                color: colors.textPrimary,
                                                                fontFamily: '"Cascadia Code", "Fira Code", monospace',
                                                                fontSize: 13,
                                                                padding: 16,
                                                                borderRadius: 8,
                                                                border: `1px solid ${isDark ? '#6366f1' : '#c7d2fe'}`,
                                                                outline: 'none',
                                                                resize: 'vertical',
                                                                lineHeight: 1.7,
                                                                boxSizing: 'border-box',
                                                            }}
                                                        />
                                                    ) : (
                                                        <pre style={{
                                                            fontSize: 13,
                                                            color: colors.textPrimary,
                                                            whiteSpace: 'pre-wrap',
                                                            wordBreak: 'break-word',
                                                            fontFamily: '"Cascadia Code", "Fira Code", monospace',
                                                            lineHeight: 1.7,
                                                            margin: 0,
                                                            padding: 0,
                                                        }}>
                                                            {displayContent}
                                                        </pre>
                                                    )}
                                                </div>
                                            ) : (
                                                <div style={{ textAlign: 'center', padding: '40px 20px', color: colors.textMuted }}>
                                                    <div style={{ fontSize: 32, marginBottom: 10 }}>📄</div>
                                                    <p style={{ fontSize: 13, fontWeight: 500 }}>
                                                        {promptFilter ? `No "${CATEGORIES[promptFilter].label}" content found in this prompt file.` : 'No prompt content found for this file.'}
                                                    </p>
                                                    {promptFilter && (
                                                        <button onClick={() => setPromptFilter(null)} style={{ marginTop: 8, fontSize: 12, color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Show full prompt</button>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    )
                                })()}
                            </div>
                        </>
                    ) : (
                        /* Welcome */
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
                            <div style={{ textAlign: 'center', maxWidth: 400 }}>
                                <div style={{ width: 64, height: 64, margin: '0 auto 20px', borderRadius: 16, background: colors.cardBg, border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <svg width="32" height="32" fill="none" stroke="#6366f1" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                                </div>
                                <h2 style={{ fontSize: 20, fontWeight: 600, color: colors.textPrimary, marginBottom: 8 }}>{project?.name || 'Project Dashboard'}</h2>
                                <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 24 }}>Select a file from the sidebar to view its NLP prompts.</p>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 24 }}>
                                    {(Object.keys(CATEGORIES) as CategoryKey[]).map(cat => {
                                        const cfg = CATEGORIES[cat]
                                        return (
                                            <div key={cat} style={{
                                                padding: 16,
                                                borderRadius: 12,
                                                background: isDark ? cfg.headerBg : cfg.lightBg,
                                                textAlign: 'center',
                                                border: `1px solid ${isDark ? 'transparent' : cfg.badgeBg}`
                                            }}>
                                                <div style={{ fontSize: 24, marginBottom: 4 }}>{cfg.icon}</div>
                                                <div style={{ fontSize: 22, fontWeight: 700, color: isDark ? cfg.headerText : cfg.lightText }}>{categorized[cat].length}</div>
                                                <div style={{ fontSize: 11, color: isDark ? cfg.badgeText : cfg.lightText, fontWeight: 500 }}>{cfg.label}</div>
                                            </div>
                                        )
                                    })}
                                </div>

                                {pages.length === 0 && (
                                    <button
                                        onClick={handleSync}
                                        disabled={syncing}
                                        style={{ padding: '8px 20px', borderRadius: 8, border: `1px solid ${colors.borderStrong}`, background: colors.cardBg, color: colors.textPrimary, fontSize: 13, fontWeight: 500, cursor: syncing ? 'wait' : 'pointer' }}
                                    >
                                        {syncing ? 'Syncing...' : 'Sync Project Files'}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </main>
            </div>

            <style jsx global>{`
                @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
                aside::-webkit-scrollbar, aside *::-webkit-scrollbar { width: 6px; }
                aside::-webkit-scrollbar-track, aside *::-webkit-scrollbar-track { background: transparent; }
                aside::-webkit-scrollbar-thumb, aside *::-webkit-scrollbar-thumb { background: #475569; border-radius: 10px; }
                aside::-webkit-scrollbar-thumb:hover, aside *::-webkit-scrollbar-thumb:hover { background: #64748b; }
                main > div::-webkit-scrollbar { width: 6px; }
                main > div::-webkit-scrollbar-track { background: transparent; }
                main > div::-webkit-scrollbar-thumb { background: #475569; border-radius: 10px; }
                main > div::-webkit-scrollbar-thumb:hover { background: #64748b; }
            `}</style>
        </div>
    )
}
