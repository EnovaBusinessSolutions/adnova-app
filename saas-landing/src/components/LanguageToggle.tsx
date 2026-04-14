import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface LanguageToggleProps {
  language: 'en' | 'es';
  setLanguage: (lang: 'en' | 'es') => void;
}

export const LanguageToggle = ({ language, setLanguage }: LanguageToggleProps) => {
  return (
    <div className="flex gap-1 p-1 bg-card rounded-lg border border-border/50">
      <Button
        variant={language === 'en' ? 'default' : 'ghost'}
        size="sm"
        onClick={() => setLanguage('en')}
        className="text-xs px-3 py-1"
      >
        EN
      </Button>
      <Button
        variant={language === 'es' ? 'default' : 'ghost'}
        size="sm"
        onClick={() => setLanguage('es')}
        className="text-xs px-3 py-1"
      >
        ES
      </Button>
    </div>
  );
};