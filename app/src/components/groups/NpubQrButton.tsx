import React from 'react';
import { IconButton, type IconButtonProps } from '@chakra-ui/react';
import { Icon } from '@iconify/react';

type NpubQrButtonProps = Omit<IconButtonProps, 'aria-label' | 'icon'> & {
  label: string;
};

export default function NpubQrButton({ label, ...props }: NpubQrButtonProps) {
  return (
    <IconButton
      aria-label={label}
      icon={<Icon icon="lucide:qr-code" width="18" height="18" />}
      variant="ghost"
      size="sm"
      {...props}
    />
  );
}
