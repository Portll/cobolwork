* SPDX-License-Identifier: AGPL-3.0-or-later
FIRST     CSECT
          USING FIRST,15
LA1       LA      1,=X'01'
LA2       LA      2,=F'1'
LA3       LA      3,=CL4'ABCD'
LA4       LA      4,=D'0'
LA5       LA      5,=H'2'
LA6       LA      6,=FD'3'
LA7       LA      7,=XL16'00'
          LTORG
DATA1     DC      X'AA'
DATA2     DS      H
DATA3     DC      C'XYZ'
DATA4     DS      2F
LENDATA4  EQU     *-DATA4
          END
