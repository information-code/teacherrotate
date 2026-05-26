'use client'

import { useState, useEffect } from 'react'

/**
 * 數字輸入框：
 *  - 點擊 / focus 時自動選取全部，方便直接打字覆蓋
 *  - 編輯過程允許「空字串」狀態（讓使用者把 0 刪掉再輸入）
 *  - blur 時才把值套用 / clamp 到 [min, max] 範圍
 */
interface NumberInputProps {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  className?: string
  placeholder?: string
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  className,
  placeholder,
}: NumberInputProps) {
  const [draft, setDraft] = useState<string>(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  function commit() {
    if (draft.trim() === '') {
      const fallback = min ?? 0
      onChange(fallback)
      setDraft(String(fallback))
      return
    }
    const n = Number(draft)
    if (!Number.isFinite(n)) {
      setDraft(String(value))
      return
    }
    let v = n
    if (min !== undefined && v < min) v = min
    if (max !== undefined && v > max) v = max
    onChange(v)
    setDraft(String(v))
  }

  return (
    <input
      type="text"
      inputMode={step && step < 1 ? 'decimal' : 'numeric'}
      pattern={step && step < 1 ? '[0-9]*\\.?[0-9]*' : '[0-9]*'}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={e => e.currentTarget.select()}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
      }}
      className={className}
    />
  )
}
