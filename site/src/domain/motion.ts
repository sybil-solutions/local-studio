const ease = [0.16, 1, 0.3, 1] as const;

export const motion = {
	ease,
	heroEnter: { duration: 0.9, ease },
	featureSwap: { duration: 0.45, ease },
} as const;
