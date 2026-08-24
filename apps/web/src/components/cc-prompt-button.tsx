'use client'

import { useState } from 'react'
import PromptModal, { type PromptTemplate } from '@/components/prompt-modal'

interface CcPromptButtonProps {
  prompts: PromptTemplate[]
}

export default function CcPromptButton({ prompts }: CcPromptButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <div className="mt-6 flex justify-end pb-6">
        <button
          onClick={() => setIsOpen(true)}
          className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-4 py-3 min-h-[48px] bg-gray-900 text-white text-sm font-medium rounded-xl shadow-sm hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 transition-colors"
          aria-label="画面改善の依頼文を開く"
          title="画面改善をAIへ依頼するための文章を開きます"
        >
          <span className="text-base leading-none">📋</span>
          <span>改善を依頼</span>
        </button>
      </div>

      <PromptModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        prompts={prompts}
      />
    </>
  )
}
