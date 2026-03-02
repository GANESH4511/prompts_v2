'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { apiRequest, getAccessToken, clearAuthData } from '@/lib/api'
import { ThemeToggle } from '@/components/ThemeToggle'

// API Base URL from environment variable
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

interface StateVar {
    id: string
    name: string
    line: number
    type: string | null
    description: string | null
}

interface PageFunc {
    id: string
    name: string
    startLine: number
    endLine: number
    purpose: string | null
}

interface Page {
    id: string
    filePath: string
    componentName: string
    totalLines: number
    purpose: string
    rawContent: string | null
    promptFilePath: string | null
    sections: Section[]
    stateVars: StateVar[]
    functions: PageFunc[]
}

interface MasterPrompt {
    id: string
    pageFilePath: string
    nlpInstruction: string
    sectionsSummary: string
    queryExamples: string
}

// --- Constants ---
const KEYWORDS = {
    FRONTEND: ['frontend', 'ui', 'component', 'style', 'css', 'html', 'react', 'view', 'display', 'render', 'button', 'input', 'modal', 'page'],
    BACKEND: ['backend', 'api', 'server', 'route', 'controller', 'service', 'node', 'express', 'endpoint', 'logic', 'handler', 'auth', 'middleware'],
    DATABASE: ['database', 'db', 'sql', 'prisma', 'schema', 'model', 'query', 'table', 'migration', 'seed', 'entity']
}

// --- Sidebar Component ---
const Sidebar = ({
    activeCategory,
    onCategoryChange,
    onOverviewClick,
    isOverviewActive,
    page,
    collapsed,
    onToggle
}: {
    activeCategory: 'FRONTEND' | 'BACKEND' | 'DATABASE' | null,
    onCategoryChange: (cat: 'FRONTEND' | 'BACKEND' | 'DATABASE' | null) => void,
    onOverviewClick: () => void,
    isOverviewActive: boolean,
    page: Page,
    collapsed: boolean,
    onToggle: () => void
}) => {
    const categories = [
        { id: 'FRONTEND' as const, label: 'Frontend', icon: '🖥️' },
        { id: 'BACKEND' as const, label: 'Backend', icon: '⚙️' },
        { id: 'DATABASE' as const, label: 'Database', icon: '🗄️' }
    ]

    // Count logic blocks (functions)
    const logicBlocks = page.functions?.length || 0

    return (
        <aside className={`prompt-sidebar ${collapsed ? 'collapsed' : ''}`}>
            {/* Dashboard Header */}
            <div className="sidebar-header">
                <button className="sidebar-menu-btn" onClick={onToggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 12h18M3 6h18M3 18h18" />
                    </svg>
                </button>
                {!collapsed && <span className="sidebar-title">DASHBOARD</span>}
            </div>

            {!collapsed && (
                <>
                    {/* Categories */}
                    <div className="sidebar-section">
                        <div className="sidebar-section-label">CATEGORIES</div>
                        {categories.map(cat => (
                            <button
                                key={cat.id}
                                onClick={() => onCategoryChange(activeCategory === cat.id ? null : cat.id)}
                                className={`sidebar-category-btn ${activeCategory === cat.id ? 'active' : ''}`}
                            >
                                <span className="sidebar-cat-icon">{cat.icon}</span>
                                <span>{cat.label}</span>
                            </button>
                        ))}
                        {/* Overview Button */}
                        <button
                            onClick={onOverviewClick}
                            className={`sidebar-category-btn ${isOverviewActive ? 'active' : ''}`}
                        >
                            <span className="sidebar-cat-icon">📋</span>
                            <span>Overview</span>
                        </button>
                    </div>

                    {/* File Stats */}
                    <div className="sidebar-section">
                        <div className="sidebar-section-label">FILE STATS</div>
                        <div className="sidebar-stat-card">
                            <div className="stat-label">LINES OF CODE</div>
                            <div className="stat-value">{page.totalLines}</div>
                        </div>
                        <div className="sidebar-stat-card">
                            <div className="stat-label">LOGIC BLOCKS</div>
                            <div className="stat-value">{logicBlocks}</div>
                        </div>
                    </div>
                </>
            )}
        </aside>
    )
}

// --- Copy Button ---
const CopyButton = ({ text }: { text: string }) => {
    const [copied, setCopied] = useState(false)

    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation()
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <button
            onClick={handleCopy}
            className={`copy-btn ${copied ? 'copied' : ''}`}
        >
            {copied ? '✓ Copied' : 'Copy'}
        </button>
    )
}

export default function PromptDetailPage() {
    const router = useRouter()
    const params = useParams()
    const searchParams = useSearchParams()
    const pageId = params.id as string
    const isEmbedded = searchParams.get('embedded') === 'true'
    const projectId = searchParams.get('projectId')

    const [page, setPage] = useState<Page | null>(null)
    const [masterPrompt, setMasterPrompt] = useState<MasterPrompt | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [isEditing, setIsEditing] = useState(false)
    const [saving, setSaving] = useState(false)
    const [promptFilter, setPromptFilter] = useState<'BOTH' | 'NLP' | 'DEVELOPER'>('BOTH')
    const [focusedFilter, setFocusedFilter] = useState<'FRONTEND' | 'BACKEND' | 'DATABASE' | null>(null)
    const [isOverview, setIsOverview] = useState(false)
    const [viewMode, setViewMode] = useState<'prompt' | 'code'>('prompt')
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [sourceCode, setSourceCode] = useState<string | null>(null)
    const [sourceCodeLoading, setSourceCodeLoading] = useState(false)
    const [sourceCodeError, setSourceCodeError] = useState<string | null>(null)
    const [isEditingCode, setIsEditingCode] = useState(false)
    const [editedCode, setEditedCode] = useState<string>('')
    const [savingCode, setSavingCode] = useState(false)
    const [sourceFilePath, setSourceFilePath] = useState<string>('')
    const [sourceLastModified, setSourceLastModified] = useState<string>('')
    const [isGenerating, setIsGenerating] = useState(false)
    const [generateStatus, setGenerateStatus] = useState<string>('')
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

    useEffect(() => {
        const token = getAccessToken()
        if (!token) {
            router.push('/login')
            return
        }
        fetchPageData()
    }, [pageId])

    const fetchPageData = async () => {
        setLoading(true)
        setError(null)
        try {
            const result = await apiRequest<{ pages: Page[], masterPrompts: MasterPrompt[] }>('/api/pages')

            if (result.status === 401) {
                clearAuthData()
                router.push('/login')
                return
            }

            if (result.success && result.data) {
                const foundPage = result.data.pages.find(p => p.id === pageId)
                if (foundPage) {
                    setPage(foundPage)
                    const foundMasterPrompt = result.data.masterPrompts.find(m => m.pageFilePath === foundPage.filePath)
                    if (foundMasterPrompt) {
                        setMasterPrompt(foundMasterPrompt)
                    }
                } else {
                    setError('Prompt file not found')
                }
            } else {
                throw new Error(result.error || 'Failed to fetch data')
            }
        } catch (err) {
            console.error('Fetch error:', err)
            setError('Could not load data. Ensure the backend server is running.')
        } finally {
            setLoading(false)
        }
    }

    // Fetch the actual source code from the codebase
    const fetchSourceCode = async () => {
        if (!pageId) return
        setSourceCodeLoading(true)
        setSourceCodeError(null)
        try {
            const result = await apiRequest<{
                success: boolean
                sourceCode: string
                filePath: string
                lastModified: string
            }>(`/api/code/${pageId}`)

            if (result.success && result.data) {
                setSourceCode(result.data.sourceCode)
                setEditedCode(result.data.sourceCode)
                setSourceFilePath(result.data.filePath)
                if (result.data.lastModified) {
                    setSourceLastModified(new Date(result.data.lastModified).toLocaleString())
                }
            } else {
                setSourceCodeError(result.error || 'Failed to load source code')
            }
        } catch (err) {
            console.error('Source code fetch error:', err)
            setSourceCodeError('Could not load source code.')
        } finally {
            setSourceCodeLoading(false)
        }
    }

    // Save the edited source code back to the file system
    const handleSaveCode = async () => {
        if (!pageId) return
        setSavingCode(true)
        try {
            const result = await apiRequest(`/api/code/${pageId}`, {
                method: 'POST',
                body: { sourceCode: editedCode }
            })

            if (result.success) {
                setSourceCode(editedCode)
                setIsEditingCode(false)
                alert('Source code saved successfully!')
                // Refresh page data to update line count
                fetchPageData()
            } else {
                throw new Error(result.error || 'Save failed')
            }
        } catch (e) {
            console.error('Code save error:', e)
            alert('Failed to save source code: ' + (e instanceof Error ? e.message : String(e)))
        } finally {
            setSavingCode(false)
        }
    }

    const downloadFile = () => {
        if (!page?.rawContent) return
        const element = document.createElement("a")
        const file = new Blob([page.rawContent], { type: 'text/plain' })
        element.href = URL.createObjectURL(file)
        element.download = page.componentName + ".txt"
        document.body.appendChild(element)
        element.click()
        document.body.removeChild(element)
    }

    // Generate prompts from source code via LLM (matches new-dashboard logic)
    const handleGenerate = async () => {
        if (!page || isGenerating) return
        setIsGenerating(true)
        const hasExistingPrompt = !!page.promptFilePath
        setGenerateStatus(hasExistingPrompt ? 'Re-generating prompts from template...' : 'Generating prompts from template...')
        try {
            const res = await fetch(`${API_URL}/api/generate-prompts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: projectId || undefined, filePath: page.filePath })
            })
            const data = await res.json()

            if (data.success) {
                setGenerateStatus(`Prompts ${hasExistingPrompt ? 're-generated' : 'generated'} successfully! (${data.elapsed})`)
                // Refresh page data to show the new prompts
                await fetchPageData()
                setTimeout(() => setGenerateStatus(''), 8000)
            } else {
                setGenerateStatus(`Generation failed: ${data.error}`)
                setTimeout(() => setGenerateStatus(''), 8000)
            }
        } catch (err) {
            console.error('Generate error:', err)
            setGenerateStatus('Generation failed: Network error')
            setTimeout(() => setGenerateStatus(''), 8000)
        } finally {
            setIsGenerating(false)
        }
    }

    const handleSave = async () => {
        if (!page) return
        setSaving(true)
        try {
            let content = ''

            // Check if we are in BOTH mode with dual textareas
            const nlpTextarea = document.getElementById(`editor-nlp-${page.id}`) as HTMLTextAreaElement
            const devTextarea = document.getElementById(`editor-dev-${page.id}`) as HTMLTextAreaElement

            if (nlpTextarea && devTextarea && page.rawContent) {
                const originalLines = page.rawContent.split('\n')
                const sortedNlp = [...nlpSections].sort((a, b) => a.startLine - b.startLine)
                const sortedDev = [...devSections].sort((a, b) => a.startLine - b.startLine)

                const replacements: { startLine: number; endLine: number; newContent: string }[] = []

                if (sortedNlp.length > 0) {
                    const nlpStart = sortedNlp[0].startLine
                    const nlpEnd = sortedNlp[sortedNlp.length - 1].endLine
                    replacements.push({ startLine: nlpStart, endLine: nlpEnd, newContent: nlpTextarea.value })
                }
                if (sortedDev.length > 0) {
                    const devStart = sortedDev[0].startLine
                    const devEnd = sortedDev[sortedDev.length - 1].endLine
                    replacements.push({ startLine: devStart, endLine: devEnd, newContent: devTextarea.value })
                }

                replacements.sort((a, b) => b.startLine - a.startLine)

                const resultLines = [...originalLines]
                for (const rep of replacements) {
                    const newLines = rep.newContent.split('\n')
                    resultLines.splice(rep.startLine - 1, rep.endLine - rep.startLine + 1, ...newLines)
                }

                content = resultLines.join('\n')
            } else {
                const textarea = document.getElementById(`editor-${page.id}`) as HTMLTextAreaElement
                if (!textarea) {
                    console.error('No textarea found for saving')
                    alert('Could not find editor content to save.')
                    return
                }
                content = textarea.value
            }

            const saveResult = await apiRequest('/api/save', {
                method: 'POST',
                body: { pageId: page.id, content }
            })

            if (!saveResult.success) {
                throw new Error(saveResult.error || 'Save failed')
            }

            const seedResult = await apiRequest('/api/seed', { method: 'POST' })
            console.log('Seed result:', seedResult)

            alert('Saved successfully!')
            router.push('/new-dashboard')
        } catch (e) {
            console.error('Save error:', e)
            alert('Failed to save changes: ' + (e instanceof Error ? e.message : String(e)))
        } finally {
            setSaving(false)
        }
    }

    // Loading state
    if (loading) {
        return (
            <div className="prompt-loading">
                <div className="prompt-spinner"></div>
            </div>
        )
    }

    // Error state
    if (error || !page) {
        return (
            <div className="prompt-error-container">
                <div className="prompt-error-card">
                    <div className="prompt-error-icon">⚠️</div>
                    <h2 className="prompt-error-title">{error || 'Page not found'}</h2>
                    <p className="prompt-error-text">The prompt file could not be loaded.</p>
                    <button onClick={() => router.push('/new-dashboard')} className="prompt-error-btn">
                        ← Back to Dashboard
                    </button>
                </div>
            </div>
        )
    }

    const filteredSections = page?.sections || []

    // Group sections by type
    const nlpSections = filteredSections.filter(s =>
        s.name.toUpperCase().includes('NLP') ||
        s.name.toUpperCase().includes('USER-DEFINED') ||
        s.name.toUpperCase().includes('USER DEFINED')
    )
    const devSections = filteredSections.filter(s =>
        s.name.toUpperCase().includes('DEVELOPER') ||
        s.name.toUpperCase().includes('DEV ') ||
        s.name.toUpperCase().includes('TECHNICAL')
    )

    // Get file path for display
    const filePath = page.filePath.toUpperCase().replace(/\\/g, '/')
    const fileInitials = page.componentName.substring(0, 2).toUpperCase()

    // Build content to display
    const getDisplayContent = () => {
        if (!page.rawContent) return ''
        const lines = page.rawContent.split('\n')

        if (promptFilter === 'NLP') {
            return nlpSections
                .sort((a, b) => a.startLine - b.startLine)
                .map(s => lines.slice(s.startLine - 1, s.endLine).join('\n'))
                .join('\n\n')
        } else if (promptFilter === 'DEVELOPER') {
            return devSections
                .sort((a, b) => a.startLine - b.startLine)
                .map(s => lines.slice(s.startLine - 1, s.endLine).join('\n'))
                .join('\n\n')
        }
        return page.rawContent
    }

    // Apply focused filter (FRONTEND/BACKEND/DATABASE)
    // Extracts content from ### Frontend/Backend/Database to the next ###
    const applyFocusedFilter = (content: string): string => {
        if (!focusedFilter || !content) return content
        const contentLines = content.split('\n')
        const filteredLines: string[] = []
        let insideMatchingBlock = false

        for (const line of contentLines) {
            const lowerLine = line.trim().toLowerCase()

            // Only treat lines starting with exactly "### " (3 hashes + space)
            // as section boundaries. Lines with "#### " (4+ hashes) are
            // sub-headings within a section and should NOT break the block.
            const isH3Heading = lowerLine.startsWith('### ') && !lowerLine.startsWith('#### ')

            if (isH3Heading) {
                // Determine which block this heading starts
                if (lowerLine.startsWith('### frontend')) {
                    insideMatchingBlock = focusedFilter === 'FRONTEND'
                } else if (lowerLine.startsWith('### backend')) {
                    insideMatchingBlock = focusedFilter === 'BACKEND'
                } else if (lowerLine.startsWith('### database')) {
                    insideMatchingBlock = focusedFilter === 'DATABASE'
                } else {
                    // Any other ### heading ends the current block
                    insideMatchingBlock = false
                }
            }

            // Also stop at section-level delimiters (=== lines) to avoid
            // bleeding into other major sections
            if (lowerLine.startsWith('===') && insideMatchingBlock && filteredLines.length > 0) {
                insideMatchingBlock = false
            }

            if (insideMatchingBlock) {
                filteredLines.push(line)
            }
        }

        return filteredLines.join('\n')
    }

    let displayContent = getDisplayContent()
    if (focusedFilter) {
        displayContent = applyFocusedFilter(displayContent)
    }

    // Build NLP and DEV content for BOTH split view
    const getNlpContent = () => {
        if (!page.rawContent) return ''
        const lines = page.rawContent.split('\n')
        let content = nlpSections
            .sort((a, b) => a.startLine - b.startLine)
            .map(s => lines.slice(s.startLine - 1, s.endLine).join('\n'))
            .join('\n\n')
        if (focusedFilter) content = applyFocusedFilter(content)
        return content
    }

    const getDevContent = () => {
        if (!page.rawContent) return ''
        const lines = page.rawContent.split('\n')
        let content = devSections
            .sort((a, b) => a.startLine - b.startLine)
            .map(s => lines.slice(s.startLine - 1, s.endLine).join('\n'))
            .join('\n\n')
        if (focusedFilter) content = applyFocusedFilter(content)
        return content
    }

    // Render content with markdown-like formatting
    const renderFormattedContent = (content: string) => {
        if (!content) return <p className="no-content-text">No content found for this section.</p>

        return content.split('\n').map((line, i) => {
            const trimmed = line.trim()

            // When focusedFilter is active, content is already extracted
            // so every line belongs to the matched section — no dimming needed
            let lineClass = 'content-line'

            // Style based on content
            if (trimmed.startsWith('SECTION ') || trimmed.startsWith('===')) {
                return <span key={i} className={`${lineClass} content-section-header`}>{line}{'\n'}</span>
            }
            if (trimmed.startsWith('### ')) {
                return <span key={i} className={`${lineClass} content-h3`}>{line}{'\n'}</span>
            }
            if (trimmed.startsWith('#### ')) {
                return <span key={i} className={`${lineClass} content-h4`}>{line}{'\n'}</span>
            }
            if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
                return <span key={i} className={`${lineClass} content-bold`}>{line}{'\n'}</span>
            }
            if (trimmed.startsWith('- **') || trimmed.startsWith('• **')) {
                return <span key={i} className={`${lineClass} content-list-bold`}>{line}{'\n'}</span>
            }
            if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
                return <span key={i} className={`${lineClass} content-list`}>{line}{'\n'}</span>
            }
            if (trimmed === '') {
                return <span key={i} className="content-empty">{'\n'}</span>
            }
            return <span key={i} className={lineClass}>{line}{'\n'}</span>
        })
    }

    return (
        <div className={`prompt-detail-layout ${isFullscreen ? 'fullscreen' : ''} ${isEmbedded ? 'embedded' : ''}`}>
            {/* Sidebar — hidden only in fullscreen mode */}
            {!isFullscreen && (
                <Sidebar
                    activeCategory={focusedFilter}
                    onCategoryChange={(cat) => {
                        setFocusedFilter(cat)
                        setIsOverview(false)
                    }}
                    onOverviewClick={() => {
                        setFocusedFilter(null)
                        setIsOverview(true)
                    }}
                    isOverviewActive={isOverview && !focusedFilter}
                    page={page}
                    collapsed={sidebarCollapsed}
                    onToggle={() => setSidebarCollapsed(prev => !prev)}
                />
            )}

            {/* Main Content */}
            <div className="prompt-main">
                {/* Top Header Bar */}
                <header className="prompt-topbar">
                    <div className="topbar-left">
                        {/* Back button — hidden in embedded mode */}
                        {!isEmbedded && (
                            <button onClick={() => router.push('/new-dashboard')} className="topbar-back-btn" title="Back to Dashboard">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </button>
                        )}
                        <div className="topbar-file-icon">
                            {fileInitials}
                        </div>
                        <div className="topbar-file-info">
                            <div className="topbar-filename">{page.componentName}.js</div>
                            <div className="topbar-filepath">{filePath}</div>
                        </div>
                    </div>

                    <div className="topbar-right">
                        <button
                            className={`topbar-action-btn generate-btn ${isGenerating ? 'generating' : ''}`}
                            onClick={handleGenerate}
                            disabled={isGenerating}
                            title={isGenerating ? generateStatus : 'Generate prompts from source code'}
                        >
                            {isGenerating ? (
                                <>
                                    <span className="generate-spinner" />
                                    Generating...
                                </>
                            ) : (
                                <>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                    {page.promptFilePath ? '✨ Re-generate' : '✨ Generate'}
                                </>
                            )}
                        </button>
                        {page.promptFilePath && (
                            <>
                                <button onClick={downloadFile} className="topbar-action-btn download-btn">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                    Download
                                </button>
                                <button
                                    onClick={() => setIsEditing(!isEditing)}
                                    className={`topbar-action-btn edit-btn ${isEditing ? 'editing' : ''}`}
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                    Edit File
                                </button>
                            </>
                        )}
                        <ThemeToggle />
                    </div>
                </header>

                {/* Generate Status Banner */}
                {generateStatus && (
                    <div style={{
                        padding: '8px 16px',
                        fontSize: 12,
                        fontWeight: 600,
                        textAlign: 'center',
                        background: generateStatus.includes('failed') || generateStatus.includes('Failed')
                            ? 'rgba(239, 68, 68, 0.1)'
                            : generateStatus.includes('successfully')
                                ? 'rgba(16, 185, 129, 0.1)'
                                : 'rgba(59, 130, 246, 0.1)',
                        color: generateStatus.includes('failed') || generateStatus.includes('Failed')
                            ? '#ef4444'
                            : generateStatus.includes('successfully')
                                ? '#10b981'
                                : '#3b82f6',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                    }}>
                        {generateStatus}
                    </div>
                )}

                {/* Controls Bar */}
                <div className="prompt-controls">
                    <div className="controls-left">
                        {/* View Mode Tabs */}
                        <div className="view-mode-tabs">
                            <span className="view-mode-label">VIEW MODE</span>
                            <button
                                onClick={() => setPromptFilter('NLP')}
                                className={`view-tab ${promptFilter === 'NLP' ? 'active' : ''}`}
                            >
                                NLP
                            </button>
                            <button
                                onClick={() => setPromptFilter('DEVELOPER')}
                                className={`view-tab ${promptFilter === 'DEVELOPER' ? 'active' : ''}`}
                            >
                                DEVELOPER
                            </button>
                            <button
                                onClick={() => setPromptFilter('BOTH')}
                                className={`view-tab ${promptFilter === 'BOTH' ? 'active' : ''}`}
                            >
                                BOTH
                            </button>
                        </div>
                    </div>
                    <div className="controls-right">
                        {/* Prompt / Code Toggle */}
                        <button
                            onClick={() => setViewMode('prompt')}
                            className={`toggle-btn prompt-toggle ${viewMode === 'prompt' ? 'active' : ''}`}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            Prompt
                        </button>
                        <button
                            onClick={() => {
                                setViewMode('code')
                                if (!sourceCode && !sourceCodeLoading) {
                                    fetchSourceCode()
                                }
                            }}
                            className={`toggle-btn code-toggle ${viewMode === 'code' ? 'active' : ''}`}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            Code
                        </button>

                        {/* Save/Bookmark icon */}
                        <button className="icon-btn" title="Bookmark">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>

                        {/* Fullscreen */}
                        <button className="icon-btn" title="Fullscreen" onClick={() => setIsFullscreen(!isFullscreen)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Content Area */}
                <div className="prompt-content-area">
                    {/* Editor Mode */}
                    {isEditing && page.rawContent && (
                        <div className="editor-container">
                            <div className="editor-header">
                                <span className="editor-title">
                                    ✏️ Editing {page.componentName}.txt
                                    {focusedFilter ? ` (${focusedFilter} filter active - read only)` : ''}
                                </span>
                                <button
                                    onClick={handleSave}
                                    disabled={saving || !!focusedFilter || isOverview}
                                    className={`save-btn ${(focusedFilter || isOverview) ? 'disabled' : ''}`}
                                >
                                    {saving ? '💾 Saving...' : focusedFilter ? '🔒 Clear filter to Save' : '💾 Save & Reprocess'}
                                </button>
                            </div>

                            {promptFilter === 'BOTH' ? (
                                <div className="editor-dual">
                                    <div className="editor-column">
                                        <div className="editor-col-header nlp">
                                            <span className="editor-col-dot nlp"></span>
                                            NLP Prompt
                                        </div>
                                        <textarea
                                            key={`nlp-${focusedFilter || 'none'}`}
                                            id={`editor-nlp-${page.id}`}
                                            className="editor-textarea"
                                            defaultValue={
                                                focusedFilter
                                                    ? applyFocusedFilter(nlpSections
                                                        .sort((a, b) => a.startLine - b.startLine)
                                                        .map(s => (page.rawContent?.split('\n') || []).slice(s.startLine - 1, s.endLine).join('\n'))
                                                        .join('\n\n'))
                                                    : nlpSections
                                                        .sort((a, b) => a.startLine - b.startLine)
                                                        .map(s => (page.rawContent?.split('\n') || []).slice(s.startLine - 1, s.endLine).join('\n'))
                                                        .join('\n\n')
                                            }
                                            readOnly={!!focusedFilter}
                                        />
                                    </div>
                                    <div className="editor-column">
                                        <div className="editor-col-header dev">
                                            <span className="editor-col-dot dev"></span>
                                            Developer Prompt
                                        </div>
                                        <textarea
                                            key={`dev-${focusedFilter || 'none'}`}
                                            id={`editor-dev-${page.id}`}
                                            className="editor-textarea"
                                            defaultValue={
                                                focusedFilter
                                                    ? applyFocusedFilter(devSections
                                                        .sort((a, b) => a.startLine - b.startLine)
                                                        .map(s => (page.rawContent?.split('\n') || []).slice(s.startLine - 1, s.endLine).join('\n'))
                                                        .join('\n\n'))
                                                    : devSections
                                                        .sort((a, b) => a.startLine - b.startLine)
                                                        .map(s => (page.rawContent?.split('\n') || []).slice(s.startLine - 1, s.endLine).join('\n'))
                                                        .join('\n\n')
                                            }
                                            readOnly={!!focusedFilter}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <textarea
                                    key={`${promptFilter}-${focusedFilter || 'none'}`}
                                    id={`editor-${page.id}`}
                                    className="editor-textarea single"
                                    defaultValue={displayContent}
                                    readOnly={!!focusedFilter}
                                />
                            )}
                        </div>
                    )}

                    {/* View Mode */}
                    {!isEditing && (
                        <>
                            {/* BOTH mode: Side-by-side split view */}
                            {promptFilter === 'BOTH' && viewMode === 'prompt' ? (
                                <div className="split-view-container">
                                    {/* NLP Column */}
                                    <div className="split-view-column">
                                        <div className="split-view-col-header">
                                            <div className="split-col-title nlp">
                                                <span className="split-col-dot nlp"></span>
                                                NLP Prompt
                                            </div>
                                            <CopyButton text={getNlpContent()} />
                                        </div>
                                        <div className="split-view-body">
                                            <pre className="content-pre">
                                                {renderFormattedContent(getNlpContent())}
                                            </pre>
                                        </div>
                                    </div>
                                    {/* Developer Column */}
                                    <div className="split-view-column">
                                        <div className="split-view-col-header">
                                            <div className="split-col-title dev">
                                                <span className="split-col-dot dev"></span>
                                                Developer Prompt
                                            </div>
                                            <CopyButton text={getDevContent()} />
                                        </div>
                                        <div className="split-view-body">
                                            <pre className="content-pre">
                                                {renderFormattedContent(getDevContent())}
                                            </pre>
                                        </div>
                                    </div>
                                </div>
                            ) : viewMode === 'code' ? (
                                /* Source Code View */
                                <div className="code-editor-wrapper">
                                    <div className="code-editor-header">
                                        <div className="code-editor-info">
                                            <div className="code-editor-dots">
                                                <span className="dot red"></span>
                                                <span className="dot yellow"></span>
                                                <span className="dot green"></span>
                                            </div>
                                            <span className="code-editor-filepath">
                                                {sourceFilePath || page.filePath}
                                            </span>
                                            {sourceLastModified && (
                                                <span className="code-editor-modified">Last modified: {sourceLastModified}</span>
                                            )}
                                        </div>
                                        <div className="code-editor-actions">
                                            {isEditingCode ? (
                                                <>
                                                    <button
                                                        onClick={() => {
                                                            setIsEditingCode(false)
                                                            setEditedCode(sourceCode || '')
                                                        }}
                                                        className="code-action-btn cancel"
                                                    >
                                                        ✕ Cancel
                                                    </button>
                                                    <button
                                                        onClick={handleSaveCode}
                                                        disabled={savingCode}
                                                        className="code-action-btn save"
                                                    >
                                                        {savingCode ? '💾 Saving...' : '💾 Save Code'}
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={() => fetchSourceCode()}
                                                        className="code-action-btn refresh"
                                                        title="Refresh code from disk"
                                                    >
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <path d="M23 4v6h-6M1 20v-6h6" strokeLinecap="round" strokeLinejoin="round" />
                                                            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" strokeLinecap="round" strokeLinejoin="round" />
                                                        </svg>
                                                        Refresh
                                                    </button>
                                                    <button
                                                        onClick={() => setIsEditingCode(true)}
                                                        className="code-action-btn edit"
                                                    >
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                                                        </svg>
                                                        Edit Code
                                                    </button>
                                                    {sourceCode && <CopyButton text={sourceCode} />}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div className="code-editor-body">
                                        {sourceCodeLoading ? (
                                            <div className="code-loading">
                                                <div className="code-loading-spinner"></div>
                                                <span>Loading source code...</span>
                                            </div>
                                        ) : sourceCodeError ? (
                                            <div className="code-error">
                                                <span className="code-error-icon">⚠️</span>
                                                <span>{sourceCodeError}</span>
                                                <button onClick={fetchSourceCode} className="code-retry-btn">Retry</button>
                                            </div>
                                        ) : isEditingCode ? (
                                            <div className="code-edit-container">
                                                <div className="code-line-numbers-gutter">
                                                    {editedCode.split('\n').map((_, i) => (
                                                        <span key={i} className="code-line-num">{i + 1}</span>
                                                    ))}
                                                </div>
                                                <textarea
                                                    className="code-edit-textarea"
                                                    style={{ color: '#ffffff' }}
                                                    value={editedCode}
                                                    onChange={(e) => setEditedCode(e.target.value)}
                                                    spellCheck={false}
                                                    autoComplete="off"
                                                    autoCorrect="off"
                                                    autoCapitalize="off"
                                                />
                                            </div>
                                        ) : sourceCode ? (
                                            <div className="code-display-container">
                                                <div className="code-line-numbers-gutter">
                                                    {sourceCode.split('\n').map((_, i) => (
                                                        <span key={i} className="code-line-num">{i + 1}</span>
                                                    ))}
                                                </div>
                                                <pre className="code-source-pre" style={{ color: '#ffffff' }}>
                                                    {sourceCode}
                                                </pre>
                                            </div>
                                        ) : (
                                            <div className="code-empty">
                                                <span>Click &quot;Code&quot; to load the source file.</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                /* Single column view (NLP, DEVELOPER) */
                                <div className="content-view-wrapper">
                                    <div className="content-view-header">
                                        <CopyButton text={displayContent} />
                                    </div>
                                    <div className="content-view-body">
                                        <pre className="content-pre">
                                            {renderFormattedContent(displayContent)}
                                        </pre>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div >
        </div >
    )
}
