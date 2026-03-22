'use client'

import { useTheme } from 'next-themes'
import { Toaster as Sonner, ToasterProps } from 'sonner'
import { isNightTheme } from '@/lib/theme-options'

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'daylight' } = useTheme()

  return (
    <Sonner
      theme={(isNightTheme(theme) ? 'dark' : 'light') as ToasterProps['theme']}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
