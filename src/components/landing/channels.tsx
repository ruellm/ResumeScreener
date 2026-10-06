import { CloudUpload, FolderOpen, Mail } from "lucide-react";
import { Container } from "./ui";

const channels = [
  { icon: CloudUpload, label: "Upload" },
  { icon: FolderOpen, label: "Google Drive" },
  { icon: Mail, label: "Email" },
];

export function Channels() {
  return (
    <section aria-labelledby="channels-heading" className="bg-indigo-50 py-10">
      <Container className="flex flex-col items-center gap-6 text-center sm:flex-row sm:justify-between sm:text-left">
        <h2 id="channels-heading" className="text-lg font-semibold text-slate-800">
          Works with the resumes you already receive
        </h2>
        <ul className="flex flex-wrap items-center justify-center gap-6 sm:gap-10">
          {channels.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <span className="flex size-10 items-center justify-center rounded-full bg-white text-indigo-600">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              {label}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
