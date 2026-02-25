'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function RootPage() {
    const router = useRouter()

    useEffect(() => {
        router.replace('/new-dashboard')
    }, [router])

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0a0a1a]">
            <div className="flex flex-col items-center gap-4">
                <div className="w-10 h-10 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                <p className="text-slate-400 text-sm">Redirecting...</p>
            </div>
        </div>
    )
}
