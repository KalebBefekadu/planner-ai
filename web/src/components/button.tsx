import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  children: React.ReactNode;
}

export function Button({ variant = 'primary', children, className = '', ...props }: ButtonProps) {
  const baseStyle = 'px-4 py-2 rounded-lg font-medium transition-all duration-200';

  let variantClass = 'btn-primary'; // Default from globals.css
  if (variant === 'secondary') variantClass = 'btn-secondary';
  if (variant === 'danger') variantClass = 'bg-red-600 hover:bg-red-700 text-white';
  if (variant === 'ghost') variantClass = 'bg-transparent hover:bg-white/5 text-gray-300';

  return (
    <button className={`${baseStyle} ${variantClass} ${className}`} {...props}>
      {children}
    </button>
  );
}
