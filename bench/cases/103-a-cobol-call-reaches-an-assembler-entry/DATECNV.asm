DATECNV  CSECT
DATECNV  AMODE 31
         ENTRY DATECONV
DATECONV STM   14,12,12(13)
         LR    12,15
         USING DATECONV,12
         L     2,0(,1)
         MVC   0(8,2),TODAY
         LM    14,12,12(13)
         SR    15,15
         BR    14
TODAY    DC    CL8'20261002'
         END
