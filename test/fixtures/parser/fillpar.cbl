       IDENTIFICATION DIVISION.
       PROGRAM-ID. FILLPAR.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 MAPI.
          02 FILLER PIC X(12).
          02 NAMEL COMP PIC S9(4).
          02 NAMEF PIC X.
          02 FILLER REDEFINES NAMEF.
             03 NAMEA PIC X.
          02 NAMEI PIC X(20).
       01 REC.
          05 FILLER.
             10 R1 PIC X.
          05 R2 PIC X(4).
          05 R3 REDEFINES R2.
             10 R31 PIC X.
       01 USED.
          05 FILLER.
             10 U1 PIC X.
             10 U2 PIC X.
       01 OUTX PIC X(40).
       PROCEDURE DIVISION.
           MOVE MAPI TO OUTX
           MOVE REC TO OUTX
           MOVE U1 TO OUTX
           GOBACK.
