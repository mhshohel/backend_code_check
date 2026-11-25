import type { CodegenConfig } from '@graphql-codegen/cli';

// One schema, two outputs:
//   server-core/src/graphql/generated/resolvers.ts - resolver signatures
//   operations.ts - typed documents for clients and acceptance tests
const scalars = { DateTime: 'string', ID: 'string' };

const config: CodegenConfig = {
  schema: '../../contracts/schema.graphql',
  documents: '../../contracts/operations/**/*.graphql',
  generates: {
    '../server-core/src/graphql/generated/resolvers.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        scalars,
        useTypeImports: true,
        enumsAsTypes: true,
        contextType: '../context#GraphQLContext',
        mappers: {
          User: '../models#UserModel',
          Category: '../models#CategoryModel',
          Warehouse: '../models#WarehouseModel',
          Product: '../models#ProductModel',
          Sku: '../models#SkuModel',
          StockLevel: '../models#BalanceModel',
          InventoryBalance: '../models#BalanceModel',
          InventoryMovement: '../models#MovementModel',
          Order: '../models#OrderModel',
          OrderLine: '../models#OrderLineModel',
          Reservation: '../models#ReservationModel',
          Payment: '../models#PaymentModel',
          Shipment: '../models#ShipmentModel',
          Return: '../models#ReturnModel',
          ReturnLine: '../models#ReturnLineModel',
          Job: '../models#JobModel',
          AuditEntry: '../models#AuditEntryModel',
          Money: '../models#MoneyModel',
          OperationsSummary: '../models#OperationsSummaryModel',
          LowStockItem: '../models#LowStockModel',
        },
      },
    },
    'src/generated/operations.ts': {
      plugins: ['typescript-operations', 'typed-document-node'],
      config: { scalars, useTypeImports: true, enumsAsTypes: true, dedupeFragments: true },
    },
  },
};

export default config;
