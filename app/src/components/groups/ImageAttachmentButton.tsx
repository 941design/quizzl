import React, { useRef } from 'react';
import { IconButton } from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';

type ImageAttachmentButtonProps = {
  onFileSelected: (file: File) => void;
  isDisabled?: boolean;
};

export default function ImageAttachmentButton({ onFileSelected, isDisabled }: ImageAttachmentButtonProps) {
  const copy = useCopy();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleClick() {
    inputRef.current?.click();
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
      // Reset so the same file can be reselected
      e.target.value = '';
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        data-testid="image-file-input"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
      <IconButton
        data-testid="image-attachment-button"
        aria-label={copy.groups.imageAttachmentLabel}
        icon={<PaperclipIcon />}
        size="sm"
        variant="ghost"
        isDisabled={isDisabled}
        onClick={handleClick}
      />
    </>
  );
}

function PaperclipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
