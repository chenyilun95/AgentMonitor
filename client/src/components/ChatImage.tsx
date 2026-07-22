import { useState } from 'react';

interface ChatImageProps {
  src: string;
  alt: string;
  title?: string;
  linked?: boolean;
}

export function ChatImage({ src, alt, title, linked = false }: ChatImageProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  const image = (
    <img
      className="chat-image"
      src={src}
      alt={alt}
      title={title}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );

  return linked ? (
    <a className="chat-image-link" href={src} target="_blank" rel="noreferrer">
      {image}
    </a>
  ) : image;
}
