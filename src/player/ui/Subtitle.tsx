export function Subtitle({ text }: { text: string | null }) {
  if (text === null) return null;
  return <div className="subtitle">{text}</div>;
}
