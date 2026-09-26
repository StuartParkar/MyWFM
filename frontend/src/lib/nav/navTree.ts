/**
 * Single source of truth for the app shell's navigation - both the sidebar
 * (components/layout/Sidebar.tsx) and the "not yet implemented" placeholder
 * resolver (app/(app)/[...slug]/page.tsx and its per-section local catch-alls)
 * read from this list, so a nav link and its destination can never drift
 * apart. `phase` is this project's own build-spec phase number (see the root
 * README's phase tracker) - it is not a guess, it is where that module is
 * scheduled to be actually implemented.
 */
export interface NavLeaf {
  label: string;
  path: string;
  available: boolean;
  phase: number;
  description: string;
}

export interface NavSection {
  label: string;
  items: NavLeaf[];
}

export const CONTROL_TOWER: NavLeaf = {
  label: "Control Tower",
  path: "/control-tower",
  available: true,
  phase: 8,
  description: "The company-wide staffing/coverage/exceptions dashboard, with drilldown from company down to interval and source record.",
};

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Workforce",
    items: [
      { label: "Workforce Planning", path: "/workforce/planning", available: false, phase: 10, description: "Current/required/future HC, hiring gap, by month/department/process/location/designation." },
      { label: "Forecast", path: "/workforce/forecast", available: false, phase: 7, description: "Deterministic forecast engine: base forecast x trend x seasonality x holiday, with accuracy/MAE/MAPE/bias." },
      { label: "Staffing", path: "/workforce/staffing", available: true, phase: 7, description: "Required/scheduled/actual staffing gap, coverage and capacity utilization." },
      { label: "Scenarios", path: "/workforce/scenarios", available: false, phase: 10, description: "What-if scenario planning (volume/AHT/shrinkage/HC changes) that never touches live data." },
    ],
  },
  {
    label: "Roster",
    items: [
      { label: "Requirements", path: "/roster/requirements", available: true, phase: 4, description: "Roster requirement submission by process/department/shift/location." },
      { label: "Review", path: "/roster/review", available: true, phase: 4, description: "Leader and HOD review of submitted roster requirements." },
      { label: "Approvals", path: "/roster/approvals", available: true, phase: 4, description: "The Requestor -> Leader -> HOD -> WFM approval workflow and its SLAs." },
      { label: "Published Roster", path: "/roster/published", available: true, phase: 4, description: "The official, versioned published roster." },
      { label: "Roster Changes", path: "/roster/changes", available: true, phase: 4, description: "Shift/weekly-off changes with full before/after audit and the change-impact simulator." },
      { label: "Calendar", path: "/roster/calendar", available: false, phase: 8, description: "Unified WFM calendar: roster, attendance, holidays, forecast, staffing, exceptions in one view." },
    ],
  },
  {
    label: "Intraday",
    items: [
      { label: "Intraday Control", path: "/intraday/control", available: false, phase: 9, description: "Interval-level required/scheduled/present/available HC, gap, calls, AHT, occupancy, service level." },
      { label: "Break Management", path: "/intraday/breaks", available: false, phase: 9, description: "Projected present HC vs. required HC as agents go on break, with coverage exceptions." },
      { label: "Exceptions", path: "/intraday/exceptions", available: false, phase: 9, description: "Configurable-threshold exception engine across staffing, service level, attendance and data quality." },
      { label: "Actions", path: "/intraday/actions", available: false, phase: 9, description: "The WFM action tracker: exception detected -> acknowledged -> action taken -> resolved." },
      { label: "OT / VTO", path: "/intraday/ot-vto", available: false, phase: 9, description: "Overtime, early release and VTO requests with before/after capacity impact." },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Calls", path: "/operations/calls", available: true, phase: 6, description: "Universal call model across phone systems: offered/answered/abandoned, AHT, workload, service level." },
      { label: "Attendance", path: "/operations/attendance", available: true, phase: 5, description: "Login/logout, net working hours, variance, late/early exceptions, on the Business Day Engine." },
      { label: "Shrinkage", path: "/operations/shrinkage", available: true, phase: 7, description: "Category-level and total shrinkage against scheduled hours." },
      { label: "Attrition", path: "/operations/attrition", available: false, phase: 7, description: "Opening/closing HC, joiners, exits, transfers, attrition rate." },
    ],
  },
  {
    label: "Reports",
    items: [
      { label: "Workforce", path: "/reports/workforce", available: false, phase: 8, description: "HC, required HC, staffing gap, capacity, utilization reporting with period comparison." },
      { label: "Calls", path: "/reports/calls", available: false, phase: 8, description: "Offered/answered/abandoned/AHT/service level/occupancy reporting with period comparison." },
      { label: "Attendance", path: "/reports/attendance", available: false, phase: 8, description: "Attendance, hours, variance, late/early/absence reporting with period comparison." },
      { label: "Staffing", path: "/reports/staffing", available: false, phase: 8, description: "Staffing gap and coverage reporting with period comparison." },
      { label: "Forecast", path: "/reports/forecast", available: false, phase: 8, description: "Forecast vs. actual, accuracy, MAE, MAPE, bias reporting." },
      { label: "Roster", path: "/reports/roster", available: false, phase: 8, description: "Roster coverage, requirement vs. published, and version history reporting." },
      { label: "Exceptions", path: "/reports/exceptions", available: false, phase: 8, description: "Exception volume and resolution reporting across every exception category." },
      { label: "Custom Reports", path: "/reports/custom", available: false, phase: 8, description: "Ad-hoc report building against the Calculation Ledger." },
    ],
  },
  {
    label: "Data",
    items: [
      { label: "Import Center", path: "/data/import-center", available: true, phase: 3, description: "Upload -> staging -> validation -> normalization -> data quality -> merge, with a unique Import ID per file." },
      { label: "Data Quality", path: "/data/data-quality", available: true, phase: 3, description: "Detected data-quality issues by severity, source and record, with a suggested corrective path." },
      { label: "Data Lineage", path: "/data/data-lineage", available: false, phase: 11, description: "KPI -> calculation -> formula version -> normalized data -> import -> original file." },
      { label: "Reprocessing", path: "/data/reprocessing", available: false, phase: 11, description: "Authorized reprocessing by date/process/department/queue/agent/import/calculation type." },
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "Employees", path: "/admin/employees", available: true, phase: 2, description: "Employee master data and organizational hierarchy." },
      { label: "Organization", path: "/admin/organization", available: true, phase: 2, description: "Department, process, location and reporting-line master data." },
      { label: "Queues", path: "/admin/queues", available: true, phase: 2, description: "Queue master data, used by staffing/coverage calculations." },
      { label: "Skills", path: "/admin/skills", available: true, phase: 2, description: "Skill definitions and agent skill assignment." },
      { label: "Shifts", path: "/admin/shifts", available: true, phase: 2, description: "Shift and weekly-off pattern master data." },
      { label: "Holidays", path: "/admin/holidays", available: true, phase: 2, description: "Holiday and operating-day calendar." },
      { label: "Configuration", path: "/admin/configuration", available: false, phase: 7, description: "The versioned Configuration Center UI over config.ConfigurationSetting." },
      { label: "Formula Library", path: "/admin/formula-library", available: true, phase: 7, description: "Every formula's version, inputs, parameters and effective date, browsable by permission." },
      { label: "Users & Roles", path: "/admin/users-roles", available: true, phase: 2, description: "User account and role administration on top of the security.* RBAC foundation." },
      { label: "Audit", path: "/admin/audit", available: true, phase: 1, description: "The audit log: who did what, when, and why." },
    ],
  },
  {
    label: "System",
    items: [
      { label: "System Health", path: "/system/health", available: true, phase: 1, description: "Database connectivity and background job queue depth." },
      { label: "Jobs", path: "/system/jobs", available: true, phase: 1, description: "Background job queue status." },
      { label: "Backup / Restore", path: "/system/backup-restore", available: false, phase: 11, description: "Guided backup/restore against scripts/backup-mywfm.ps1 and restore-mywfm.ps1." },
    ],
  },
];

export function findNavLeaf(pathname: string): NavLeaf | undefined {
  if (pathname === CONTROL_TOWER.path) return CONTROL_TOWER;
  for (const section of NAV_SECTIONS) {
    const found = section.items.find((item) => item.path === pathname);
    if (found) return found;
  }
  return undefined;
}
