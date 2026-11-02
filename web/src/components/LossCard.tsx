// A blank table value with its meaning, muted: "Not recorded" (should exist, missing), "Not applicable", "No ports yet".
export const Blank = ({ children = "Not recorded" }: { children?: string }) => <span className="font-normal text-muted-foreground">{children}</span>;
