// This file extends the AdapterConfig type from "@iobroker/types"
// using the actual properties present in io-package.json
// in order to provide typings for adapter.config properties

export {};

declare global {
    namespace ioBroker {
        interface AdapterConfig {
            host: string;
            port: number;
            unitId: number;
            requestTimeout: number;
            fastPollInterval: number;
            slowPollInterval: number;
            enableEmsControl: boolean;
        }
    }
}
