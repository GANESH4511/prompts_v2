'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getAccessToken, getStoredUser, verifyToken, logout, apiRequest, clearAuthData } from '@/lib/api';
import { ProfilePanel } from '@/components/ProfilePanel';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { useTheme } from '@/components/ThemeProvider';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

interface Project {
    id: string;
    name: string;
    path: string;
    description: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

interface User {
    id: string;
    email: string;
    name: string;
    role: string;
}

interface DirectoryItem {
    name: string;
    path: string;
}

export default function HomePage() {
    const router = useRouter();
    const { getDashboardRoute } = useDashboardMode();
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const [user, setUser] = useState<User | null>(null);
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [showNewProject, setShowNewProject] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectDescription, setNewProjectDescription] = useState('');
    const [selectedPath, setSelectedPath] = useState('');
    const [browsing, setBrowsing] = useState(false);
    const [currentBrowsePath, setCurrentBrowsePath] = useState('');
    const [directories, setDirectories] = useState<DirectoryItem[]>([]);
    const [browseLoading, setBrowseLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState('');
    const [browseHistory, setBrowseHistory] = useState<string[]>([]);
    const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; project: Project | null }>({ show: false, project: null });
    const [deleting, setDeleting] = useState(false);
    const [showProfile, setShowProfile] = useState(false);

    useEffect(() => {
        checkAuth();
    }, []);

    useEffect(() => {
        if (user) {
            fetchProjects();
        }
    }, [user]);

    const checkAuth = async () => {
        try {
            // First check if we have stored credentials
            const storedUser = getStoredUser();
            const token = getAccessToken();

            if (!storedUser || !token) {
                router.push('/login');
                return;
            }

            // Verify token with backend
            const verification = await verifyToken();

            if (verification.valid && verification.user) {
                setUser(verification.user);
            } else {
                // Token invalid - clear and redirect
                clearAuthData();
                router.push('/login');
                return;
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            clearAuthData();
            router.push('/login');
        } finally {
            setLoading(false);
        }
    };

    const fetchProjects = async () => {
        if (!user) return;

        try {
            const result = await apiRequest<{ success: boolean; projects: Project[] }>(`/api/projects/user/${user.id}`);

            if (result.success && result.data?.success) {
                setProjects(result.data.projects);
                // If no projects, show the new project form
                if (result.data.projects.length === 0) {
                    setShowNewProject(true);
                }
            } else if (result.status === 401) {
                // Token expired - redirect to login
                clearAuthData();
                router.push('/login');
            }
        } catch (err) {
            console.error('Error fetching projects:', err);
        }
    };

    const browseDirectory = async (path: string, addToHistory: boolean = true) => {
        setBrowseLoading(true);
        try {
            const result = await apiRequest(`/api/projects/browse?path=${encodeURIComponent(path)}${user ? `&userId=${user.id}` : ''}`);

            if (result.success && result.data?.success) {
                // Add current path to history before navigating (if not going back)
                if (addToHistory && currentBrowsePath && currentBrowsePath !== path) {
                    setBrowseHistory(prev => [...prev, currentBrowsePath]);
                }
                setCurrentBrowsePath(result.data.currentPath);
                setDirectories(result.data.directories);
            }
        } catch (err) {
            console.error('Error browsing directory:', err);
        } finally {
            setBrowseLoading(false);
        }
    };

    const openBrowser = async () => {
        // Try native Windows folder picker first
        try {
            const result = await apiRequest('/api/projects/pick-folder', { method: 'POST' });

            if (result.success && result.data?.success && !result.data?.cancelled && result.data?.path) {
                // Native picker returned a folder — use it
                setSelectedPath(result.data.path);
                // Auto-fill project name if empty
                if (!newProjectName) {
                    const folderName = result.data.path.split('/').pop() || 'New Project';
                    setNewProjectName(folderName.charAt(0).toUpperCase() + folderName.slice(1));
                }
                return;
            }

            // User cancelled the native dialog — fall through to in-browser browser
        } catch (err) {
            console.error('Native folder picker failed, falling back to browser:', err);
        }

        // Fallback: open in-browser file browser
        setBrowsing(true);
        setBrowseHistory([]);
        browseDirectory(currentBrowsePath || '', false);
    };

    const goBack = () => {
        if (browseHistory.length > 0) {
            const previousPath = browseHistory[browseHistory.length - 1];
            setBrowseHistory(prev => prev.slice(0, -1)); // Remove last item
            browseDirectory(previousPath, false); // Don't add to history when going back
        }
    };

    const selectDirectory = (path: string) => {
        setSelectedPath(path);
        setBrowsing(false);
        setBrowseHistory([]); // Clear history when selecting
        // Auto-fill project name if empty
        if (!newProjectName) {
            const folderName = path.split('/').pop() || 'New Project';
            setNewProjectName(folderName.charAt(0).toUpperCase() + folderName.slice(1));
        }
    };

    const createProject = async () => {
        if (!user || !newProjectName || !selectedPath) return;

        setCreating(true);
        setError('');

        try {
            const result = await apiRequest('/api/projects', {
                method: 'POST',
                body: {
                    userId: user.id,
                    name: newProjectName,
                    path: selectedPath,
                    description: newProjectDescription
                }
            });

            if (result.success && result.data?.success) {
                setShowNewProject(false);
                setNewProjectName('');
                setNewProjectDescription('');
                setSelectedPath('');
                await fetchProjects();
                // Navigate to the dashboard based on mode
                router.push(getDashboardRoute());
            } else {
                setError(result.error || result.data?.message || 'Failed to create project');
            }
        } catch (err) {
            console.error('Error creating project:', err);
            setError('Failed to create project. Please try again.');
        } finally {
            setCreating(false);
        }
    };

    const activateProject = async (projectId: string) => {
        if (!user) return;

        try {
            const result = await apiRequest(`/api/projects/${projectId}/activate`, {
                method: 'PUT',
                body: { userId: user.id }
            });

            if (result.success && result.data?.success) {
                await fetchProjects();
                // Navigate to the dashboard based on mode
                router.push(getDashboardRoute());
            }
        } catch (err) {
            console.error('Error activating project:', err);
        }
    };

    const deleteProject = async (projectId: string) => {
        const project = projects.find(p => p.id === projectId);
        if (project) {
            setDeleteConfirm({ show: true, project });
        }
    };

    const performDelete = async () => {
        if (!deleteConfirm.project) return;

        setDeleting(true);
        try {
            const result = await apiRequest(`/api/projects/${deleteConfirm.project.id}`, {
                method: 'DELETE'
            });

            if (result.success && result.data?.success) {
                setDeleteConfirm({ show: false, project: null });
                await fetchProjects();
            }
        } catch (err) {
            console.error('Error deleting project:', err);
        } finally {
            setDeleting(false);
        }
    };

    const handleLogout = async () => {
        await logout();
        router.push('/login');
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen relative overflow-hidden">
            {/* Animated Background */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-20 -right-20 sm:-top-40 sm:-right-40 w-48 h-48 sm:w-72 md:w-96 sm:h-72 md:h-96 bg-indigo-500/20 rounded-full blur-3xl animate-pulse" />
                <div className="absolute -bottom-20 -left-20 sm:-bottom-40 sm:-left-40 w-48 h-48 sm:w-72 md:w-96 sm:h-72 md:h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
            </div>

            <div className="relative z-10 p-4 sm:p-6 lg:p-8">
                {/* Header */}
                <header className="max-w-6xl mx-auto mb-6 sm:mb-8 lg:mb-10 glass-panel rounded-xl sm:rounded-2xl p-4 sm:p-6">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div className="flex items-center gap-3 sm:gap-4">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg flex-shrink-0">
                                <svg className="w-5 h-5 sm:w-7 sm:h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                </svg>
                            </div>
                            <div>
                                <h1 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                                    Project Hub
                                </h1>
                                <p className="text-xs sm:text-sm text-gray-400 truncate max-w-[200px] sm:max-w-none">Welcome back, {user?.name}</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto justify-end">
                            <button
                                onClick={() => setShowNewProject(true)}
                                className="px-3 sm:px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg sm:rounded-xl font-semibold text-xs sm:text-sm transition-all flex items-center gap-1 sm:gap-2 shadow-lg shadow-indigo-500/25"
                            >
                                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                </svg>
                                <span className="hidden xs:inline">New Project</span>
                                <span className="xs:hidden">New</span>
                            </button>

                            {/* Profile Avatar Button */}
                            <button
                                onClick={() => setShowProfile(true)}
                                id="profile-btn"
                                style={{
                                    width: 40, height: 40,
                                    borderRadius: 12,
                                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 14, fontWeight: 700, color: '#fff',
                                    border: 'none', cursor: 'pointer',
                                    boxShadow: '0 2px 8px rgba(99, 102, 241, 0.3)',
                                    transition: 'all 0.2s ease',
                                    flexShrink: 0,
                                }}
                                title="Profile & Settings"
                            >
                                {user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'}
                            </button>
                        </div>
                    </div>
                </header>

                <main className="max-w-6xl mx-auto">
                    {/* New Project Modal */}
                    {showNewProject && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/70 backdrop-blur-sm overflow-y-auto">
                            <div className="w-full max-w-2xl glass-panel rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-8 animate-pulse-glow my-4">
                                <div className="flex items-center justify-between mb-4 sm:mb-6">
                                    <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-white">
                                        {projects.length === 0 ? 'Create Your First Project' : 'New Project'}
                                    </h2>
                                    {projects.length > 0 && (
                                        <button
                                            onClick={() => setShowNewProject(false)}
                                            className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-lg bg-white/5 hover:bg-red-500/20 hover:text-red-400 transition-colors text-lg sm:text-xl"
                                        >
                                            ×
                                        </button>
                                    )}
                                </div>

                                {error && (
                                    <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                                        {error}
                                    </div>
                                )}

                                <div className="space-y-4 sm:space-y-6">
                                    {/* Project Name */}
                                    <div>
                                        <label className="block text-xs sm:text-sm font-medium text-gray-300 mb-1.5 sm:mb-2">
                                            Project Name
                                        </label>
                                        <input
                                            type="text"
                                            value={newProjectName}
                                            onChange={(e) => setNewProjectName(e.target.value)}
                                            placeholder="My Awesome Project"
                                            className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-white/5 border border-white/10 rounded-lg sm:rounded-xl text-sm sm:text-base text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                                        />
                                    </div>

                                    {/* Project Path */}
                                    <div>
                                        <label className="block text-xs sm:text-sm font-medium text-gray-300 mb-1.5 sm:mb-2">
                                            Project Folder
                                        </label>
                                        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                                            <input
                                                type="text"
                                                value={selectedPath}
                                                onChange={(e) => setSelectedPath(e.target.value)}
                                                placeholder="/path/to/your/project"
                                                className="flex-1 px-3 sm:px-4 py-2.5 sm:py-3 bg-white/5 border border-white/10 rounded-lg sm:rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-mono text-xs sm:text-sm"
                                            />
                                            <button
                                                onClick={openBrowser}
                                                className="px-3 sm:px-4 py-2.5 sm:py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg sm:rounded-xl transition-all flex items-center justify-center gap-2"
                                            >
                                                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                                </svg>
                                                <span className="text-sm">Browse</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Directory Browser */}
                                    {browsing && (
                                        <div className="bg-black/30 rounded-lg sm:rounded-xl border border-white/10 overflow-hidden">
                                            <div className="p-2 sm:p-3 bg-white/5 border-b border-white/10 flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-400 font-mono overflow-hidden">
                                                    <span className="flex-shrink-0">📂</span>
                                                    <span className="truncate">{currentBrowsePath}</span>
                                                </div>
                                                <button
                                                    onClick={goBack}
                                                    disabled={browseHistory.length === 0}
                                                    className={`px-2 sm:px-3 py-1 rounded-lg text-xs sm:text-sm transition-colors flex-shrink-0 flex items-center gap-1.5 ${browseHistory.length > 0
                                                        ? 'bg-white/5 hover:bg-white/10 text-gray-300'
                                                        : 'bg-white/5 text-gray-600 cursor-not-allowed'
                                                        }`}
                                                >
                                                    <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                                    </svg>
                                                    Back
                                                </button>
                                            </div>
                                            <div className="max-h-48 sm:max-h-60 overflow-y-auto p-2">
                                                {browseLoading ? (
                                                    <div className="flex justify-center py-6 sm:py-8">
                                                        <div className="w-6 h-6 sm:w-8 sm:h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
                                                    </div>
                                                ) : directories.length === 0 ? (
                                                    <div className="text-center py-6 sm:py-8 text-gray-500 text-sm">
                                                        No subdirectories found
                                                    </div>
                                                ) : (
                                                    <div className="space-y-1">
                                                        {directories.map((dir) => (
                                                            <div
                                                                key={dir.path}
                                                                className="flex items-center justify-between p-2 sm:p-3 rounded-lg hover:bg-white/5 active:bg-white/10 transition-colors group"
                                                            >
                                                                <button
                                                                    onClick={() => browseDirectory(dir.path)}
                                                                    className="flex items-center gap-2 sm:gap-3 flex-1 text-left min-w-0"
                                                                >
                                                                    <span className="text-base sm:text-lg flex-shrink-0">📁</span>
                                                                    <span className="text-gray-300 group-hover:text-white transition-colors text-sm truncate">
                                                                        {dir.name}
                                                                    </span>
                                                                </button>
                                                                <button
                                                                    onClick={() => selectDirectory(dir.path)}
                                                                    className="px-2 sm:px-3 py-1 bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-300 rounded-lg text-xs sm:text-sm sm:opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                                                                >
                                                                    Select
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="p-2 sm:p-3 bg-white/5 border-t border-white/10 flex flex-col sm:flex-row gap-2 sm:justify-between">
                                                <button
                                                    onClick={() => selectDirectory(currentBrowsePath)}
                                                    className="px-3 sm:px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs sm:text-sm font-semibold transition-colors w-full sm:w-auto"
                                                >
                                                    Select Current Folder
                                                </button>
                                                <button
                                                    onClick={() => setBrowsing(false)}
                                                    className="px-3 sm:px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-xs sm:text-sm transition-colors w-full sm:w-auto"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Description */}
                                    <div>
                                        <label className="block text-xs sm:text-sm font-medium text-gray-300 mb-1.5 sm:mb-2">
                                            Description (optional)
                                        </label>
                                        <textarea
                                            value={newProjectDescription}
                                            onChange={(e) => setNewProjectDescription(e.target.value)}
                                            placeholder="Brief description of your project..."
                                            rows={3}
                                            className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-white/5 border border-white/10 rounded-lg sm:rounded-xl text-sm sm:text-base text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all resize-none"
                                        />
                                    </div>

                                    {/* Submit Button */}
                                    <button
                                        onClick={createProject}
                                        disabled={!newProjectName || !selectedPath || creating}
                                        className="w-full py-3 sm:py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg sm:rounded-xl font-semibold text-sm sm:text-base lg:text-lg transition-all shadow-lg shadow-indigo-500/25"
                                    >
                                        {creating ? (
                                            <span className="flex items-center justify-center gap-2">
                                                <div className="w-4 h-4 sm:w-5 sm:h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                                Creating...
                                            </span>
                                        ) : (
                                            'Create Project'
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Projects Grid */}
                    {projects.length > 0 ? (
                        <div className="space-y-4 sm:space-y-6">
                            <div className="flex items-center justify-between">
                                <h2 className="text-lg sm:text-xl font-bold text-white">Your Projects</h2>
                                <span className="text-xs sm:text-sm text-gray-400">{projects.length} project(s)</span>
                            </div>

                            <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                                {projects.map((project) => (
                                    <div
                                        key={project.id}
                                        className={`glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6 transition-all cursor-pointer group ${project.isActive
                                            ? 'ring-2 ring-indigo-500 shadow-lg shadow-indigo-500/20'
                                            : 'hover:ring-1 hover:ring-white/20 active:ring-1 active:ring-indigo-500/50'
                                            }`}
                                        onClick={() => activateProject(project.id)}
                                    >
                                        <div className="flex items-start justify-between mb-3 sm:mb-4">
                                            <div className={`w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center ${project.isActive
                                                ? 'bg-gradient-to-br from-indigo-500 to-purple-600'
                                                : 'bg-white/5'
                                                }`}>
                                                <svg className="w-5 h-5 sm:w-7 sm:h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                                </svg>
                                            </div>
                                            {project.isActive && (
                                                <span className="px-1.5 sm:px-2 py-0.5 sm:py-1 bg-green-500/20 text-green-400 text-[10px] sm:text-xs font-medium rounded-full">
                                                    Active
                                                </span>
                                            )}
                                        </div>

                                        <h3 className="text-base sm:text-lg font-bold text-white mb-1 group-hover:text-indigo-300 transition-colors">
                                            {project.name}
                                        </h3>
                                        <p className="text-[10px] sm:text-xs text-gray-500 font-mono mb-2 sm:mb-3 truncate" title={project.path}>
                                            {project.path}
                                        </p>
                                        {project.description && (
                                            <p className="text-xs sm:text-sm text-gray-400 mb-3 sm:mb-4 line-clamp-2">
                                                {project.description}
                                            </p>
                                        )}

                                        <div className="flex items-center justify-between pt-3 sm:pt-4 border-t border-white/10">
                                            <span className="text-[10px] sm:text-xs text-gray-500">
                                                Updated {new Date(project.updatedAt).toLocaleDateString()}
                                            </span>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        deleteProject(project.id);
                                                    }}
                                                    className="p-1.5 sm:p-2 bg-red-500/10 hover:bg-red-500/25 text-red-400 hover:text-red-300 rounded-lg transition-all border border-red-500/20 hover:border-red-500/40"
                                                    title="Delete project"
                                                >
                                                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                {/* Add New Project Card */}
                                <button
                                    onClick={() => setShowNewProject(true)}
                                    className="glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6 border-2 border-dashed border-white/10 hover:border-indigo-500/50 active:border-indigo-500/50 transition-all flex flex-col items-center justify-center min-h-[160px] sm:min-h-[200px] group"
                                >
                                    <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-white/5 group-hover:bg-indigo-500/20 flex items-center justify-center mb-3 sm:mb-4 transition-colors">
                                        <svg className="w-5 h-5 sm:w-7 sm:h-7 text-gray-500 group-hover:text-indigo-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                        </svg>
                                    </div>
                                    <span className="text-sm sm:text-base text-gray-500 group-hover:text-indigo-400 font-medium transition-colors">
                                        Add New Project
                                    </span>
                                </button>
                            </div>
                        </div>
                    ) : !showNewProject && (
                        <div className="text-center py-12 sm:py-16 lg:py-20 glass-panel rounded-2xl sm:rounded-3xl px-4">
                            <div className="text-4xl sm:text-5xl lg:text-6xl mb-4 sm:mb-6 opacity-50">📂</div>
                            <h2 className="text-xl sm:text-2xl font-bold text-white mb-3 sm:mb-4">No Projects Yet</h2>
                            <p className="text-sm sm:text-base text-gray-400 mb-6 sm:mb-8 max-w-md mx-auto">
                                Get started by creating your first project. Select a folder containing your prompt files.
                            </p>
                            <button
                                onClick={() => setShowNewProject(true)}
                                className="px-6 sm:px-8 py-2.5 sm:py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg sm:rounded-xl font-bold text-sm sm:text-base shadow-lg shadow-indigo-500/25 transition-all"
                            >
                                Create First Project
                            </button>
                        </div>
                    )}

                    {/* Delete Confirmation Modal */}
                    {deleteConfirm.show && deleteConfirm.project && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                            <div className="w-full max-w-md glass-panel rounded-2xl sm:rounded-3xl p-6 sm:p-8 animate-pulse-glow">
                                {/* Warning Icon */}
                                <div className="flex justify-center mb-5">
                                    <div className="w-16 h-16 rounded-full bg-red-500/15 flex items-center justify-center">
                                        <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </div>
                                </div>

                                {/* Title */}
                                <h3 className="text-xl font-bold text-white text-center mb-2">
                                    Delete Project
                                </h3>

                                {/* Project Name */}
                                <p className="text-sm text-gray-400 text-center mb-4">
                                    Are you sure you want to delete <span className="font-semibold text-white">"{deleteConfirm.project.name}"</span>?
                                </p>

                                {/* Safety Notice */}
                                <div className="mb-6 p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                                    <div className="flex items-start gap-2">
                                        <svg className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <div>
                                            <p className="text-sm font-medium text-green-400">Safe to delete</p>
                                            <p className="text-xs text-green-400/70 mt-0.5">
                                                This will only remove the project from the database. Your source files and root folder will <strong>NOT</strong> be affected.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Project Path Info */}
                                <div className="mb-6 p-3 rounded-xl bg-white/5 border border-white/10">
                                    <p className="text-[10px] text-gray-500 mb-1">Project path (will remain untouched)</p>
                                    <p className="text-xs text-gray-400 font-mono truncate" title={deleteConfirm.project.path}>
                                        {deleteConfirm.project.path}
                                    </p>
                                </div>

                                {/* Buttons */}
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setDeleteConfirm({ show: false, project: null })}
                                        disabled={deleting}
                                        className="flex-1 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={performDelete}
                                        disabled={deleting}
                                        className="flex-1 py-3 bg-red-600 hover:bg-red-500 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-red-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        {deleting ? (
                                            <>
                                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                                Deleting...
                                            </>
                                        ) : (
                                            <>Delete Project</>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>

            {/* Profile Panel */}
            {user && (
                <ProfilePanel
                    user={user}
                    isOpen={showProfile}
                    onClose={() => setShowProfile(false)}
                    onLogout={handleLogout}
                />
            )}
        </div>
    );
}
