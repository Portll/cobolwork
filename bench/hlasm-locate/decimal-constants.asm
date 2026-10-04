* SPDX-License-Identifier: AGPL-3.0-or-later
FIRST    CSECT
         USING FIRST,15
AP1      DC    P'12345678'
AP2      DC    PL4'1234'
AP3      DC    P'12345678',P'87654321'
AZ1      DC    Z'12345678'
AZ2      DC    ZL5'12345'
AZ3      DC    Z'12345678',Z'87654321'
L1       LA    1,AP1
L2       LA    2,AP2
L3       LA    3,AP3
L4       LA    4,AZ1
L5       LA    5,AZ2
L6       LA    6,AZ3
L7       L     1,AP1
L8       L     2,AP2
L9       L     3,AP3
L10      L     4,AZ1
L11      L     5,AZ2
L12      L     6,AZ3
L13      ST    1,AP1
L14      ST    2,AP2
L15      ST    3,AP3
L16      ST    4,AZ1
L17      ST    5,AZ2
L18      ST    6,AZ3
L19      BR    14
         LTORG
         END
