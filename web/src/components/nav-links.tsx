'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function NavLinks() {
  const pathname = usePathname()

  const links = [
    { name: 'Dump', href: '/' },
    { name: 'Vision', href: '/vision' },
    { name: 'Goals', href: '/goals' },
  ]

  return (
    <>
      {links.map(link => {
        const isActive = pathname === link.href
        return (
          <Link 
            key={link.name} 
            href={link.href}
            style={{ 
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: isActive ? 600 : 500,
              textDecoration: 'none',
              transition: 'color 0.2s'
            }}
          >
            {link.name}
          </Link>
        )
      })}
    </>
  )
}
