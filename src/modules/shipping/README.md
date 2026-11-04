# Shipping

The ERD has no Shipment model or carrier integration. Public APIs list active
ShippingMethods. Admins manage those methods and the existing Order
`shippingProvider`/`trackingNumber` fields. Shipping lifecycle uses the explicit
Order `CONFIRMED -> SHIPPED -> DELIVERED` transitions and OrderStatusHistory;
customer shipment reads are always scoped by Order ownership.
The anonymous product shipping preview resolves active methods through the
same zone matching rules as checkout. It returns configured minor-unit prices
and estimates without creating an Order, Payment, or Cart mutation.
