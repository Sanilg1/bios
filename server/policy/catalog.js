// Mock resources, purposes and controls. Everything here is fake by design.
export const PURPOSES = ["evaluation", "internal-research", "prototype-demo", "fine-tuning", "large-scale-training"];

export const CONTROLS = [
  "no-export",
  "rate-limit",
  "output-watermark",
  "logging-required",
  "synthetic-inputs-only",
  "no-network-egress",
  "approved-images-only",
];

export const COMPUTE_ONLY_CONTROLS = ["no-network-egress", "approved-images-only"];

export const APPROVED_IMAGES = ["netra/eval-harness:1.0", "netra/finetune-lora:1.0"];

export const MAX_DURATION_DAYS = 30;

export const SLOTS = ["manager", "risk", "owner"];

// Which role may fill which review slot.
export const SLOT_ROLE = { manager: "manager", risk: "risk", owner: "owner" };

export const ROLES = ["requester", "manager", "risk", "owner"];

export function seedResources(ownerSubs = []) {
  return [
    {
      id: "model:sentinel-eval-mock",
      name: "Sentinel (mock sensitive model)",
      type: "model",
      description: "The fictional sensitive model from Maya's story. Returns canned fake scores.",
      allowedPurposes: ["evaluation", "internal-research", "prototype-demo"],
      ownerSubs: [...ownerSubs],
    },
    {
      id: "model:summarizer-mock",
      name: "Summarizer (mock)",
      type: "model",
      description: "Returns lorem-ipsum summaries.",
      allowedPurposes: ["evaluation", "internal-research", "prototype-demo", "fine-tuning"],
      ownerSubs: [...ownerSubs],
    },
    {
      id: "dataset:synthetic-support-tickets",
      name: "Synthetic support tickets",
      type: "dataset",
      description: "50 generated rows, each prefixed SYNTHETIC.",
      allowedPurposes: ["evaluation", "internal-research", "fine-tuning"],
      ownerSubs: [...ownerSubs],
    },
    {
      id: "dataset:synthetic-claims-sample",
      name: "Synthetic claims sample",
      type: "dataset",
      description: "Generated rows labelled SYNTHETIC.",
      allowedPurposes: ["evaluation", "internal-research"],
      ownerSubs: [...ownerSubs],
    },
    {
      id: "compute:h100-pool-mock",
      name: "H100 pool (mock, 8 GPUs)",
      type: "compute",
      description: "A fake pool of 8 H100s. Nothing runs on real hardware; jobs are records with a fake progress bar.",
      allowedPurposes: ["evaluation", "internal-research", "fine-tuning", "large-scale-training"],
      maxGpus: 8,
      ownerSubs: [...ownerSubs],
    },
  ];
}

// Fictional personas for dev login and the break-it sandbox.
export const PERSONAS = [
  { sub: "persona:maya", name: "Maya Rao", title: "Researcher (requester)", roles: ["requester"] },
  { sub: "persona:kabir", name: "Kabir Singh", title: "Final-year student (requester)", roles: ["requester"] },
  { sub: "persona:priya", name: "Priya Nair", title: "PhD student (requester)", roles: ["requester"] },
  { sub: "persona:arjun", name: "Arjun Desai", title: "Research engineer (requester)", roles: ["requester"] },
  { sub: "persona:guide", name: "Dr. Anjali Mehta", title: "Faculty guide (manager)", roles: ["manager"] },
  { sub: "persona:risk", name: "Farhan Ali", title: "IT security (risk reviewer)", roles: ["risk"] },
  { sub: "persona:ira", name: "Ira Kapoor", title: "HPC admin (resource owner)", roles: ["owner"] },
  { sub: "persona:neel", name: "Neel Batra", title: "Manager + risk reviewer", roles: ["manager", "risk"] },
];

export const PERSONA_OWNER = "persona:ira";
