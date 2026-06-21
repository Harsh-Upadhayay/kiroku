import React from "react";
import { motion } from "motion/react";

/**
 * Keep-alive tab wrapper. Children stay mounted across switches; the panel is hidden
 * (display:none) when inactive and fades back in when it becomes active. Only this wrapper
 * animates — the content never unmounts, so there's no remount, refetch, or blank flash.
 */
export function TabPanel({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <motion.div
      hidden={!active}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: active ? 1 : 0, y: active ? 0 : 6 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

export default TabPanel;
