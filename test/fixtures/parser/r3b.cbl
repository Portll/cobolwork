       IDENTIFICATION DIVISION.
       PROGRAM-ID. R3B.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 RDX.
          02 N1.
             03 N1A PIC XX.
             03 N1B PIC XXX.
          02 N2 PIC X(10).
          02 N3.
             09 N3A PIC XXX.
             09 N3B PIC XX.
       66 R1 RENAMES N1 THRU N3.
       66 R2 RENAMES N1A THRU N1B.
       66 R3 RENAMES N2.
       66 R4 RENAMES N1B THRU N3A.
       01 QA.
          02 AL PIC XX.
          02 GRP.
             04 BOB PIC XXX.
       01 QB.
          02 PAD PIC X(7).
          02 AL PIC XX.
          02 GRP2.
             04 BOB PIC XXX.
       66 AB RENAMES AL OF QB THRU BOB OF QB.
       PROCEDURE DIVISION.
           GOBACK.
