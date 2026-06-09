import React from "react";
import { AnkiCloneWorkspace } from "./AnkiCloneWorkspace";

export const AnkiPage: React.FC = () => (
  <div className="space-y-6" id="anki-view">
    <AnkiCloneWorkspace />
  </div>
);

export default AnkiPage;
