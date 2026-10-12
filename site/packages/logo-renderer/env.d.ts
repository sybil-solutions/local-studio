declare interface ImportMetaEnv {
	readonly DEV: boolean;
	readonly PROD: boolean;
}

declare interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare const GPUTextureUsage: {
	readonly COPY_SRC: number;
	readonly COPY_DST: number;
	readonly TEXTURE_BINDING: number;
	readonly STORAGE_BINDING: number;
	readonly RENDER_ATTACHMENT: number;
};

